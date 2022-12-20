import { Construct } from "constructs"
import * as cdk from "aws-cdk-lib"
import * as sc from "@aws-cdk/aws-servicecatalog-alpha"
import { EmrStack, EmrStackProps } from "./emr-product-stack"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as sagemaker from "aws-cdk-lib/aws-sagemaker"
import { addIngress } from "./add-ingress"
import { IVpc } from "aws-cdk-lib/aws-ec2"
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment"
import { CfnOutput } from "aws-cdk-lib"
import { NagSuppressions } from "cdk-nag"
import { createLaunchConstraint } from "./launch-constraint"
import { createPermissionsBoundary } from "./permission-boundary"
import { createSagemakerExecutionRole } from "./sagemaker-execution"
import * as ssm from "aws-cdk-lib/aws-ssm"
import * as iam from "aws-cdk-lib/aws-iam"
import * as cr from "aws-cdk-lib/custom-resources"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as emr from "aws-cdk-lib/aws-emr"
import * as kms from "aws-cdk-lib/aws-kms"


/**
 * This construct creates a VPC, a SageMaker domain, and a Service Catalog product.
 *
 * The service catalog product template is created in `emr-product-stack.ts`.
 */
export class ProductConstruct extends Construct {

    public vpc: IVpc
    public trainingBucket: s3.IBucket

    constructor(scope: Construct, id: string) {
        super(scope, id)

        const self = this

        // the global permissions boundary applied to all user/roles that will be created
        const permissionsBoundary = createPermissionsBoundary(this)

        // Create the VPC
        this.vpc = new ec2.Vpc(this, "vpc", {})
        this.vpc.addFlowLog("flow-log-cw", {
            trafficType: ec2.FlowLogTrafficType.REJECT
        })

        NagSuppressions.addResourceSuppressions(this.vpc, [
            {id: "AwsSolutions-EC23", reason: "cdk-nag can't read Fn::GetAtt"}
        ], true)

        // Create a bucket to hold access logs for the other buckets
        const logBucket = new s3.Bucket(this, "access-logs", {
            encryption: s3.BucketEncryption.S3_MANAGED,
            autoDeleteObjects: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            versioned: true
        })

        // Suppress nag error since this is the log bucket itself.
        NagSuppressions.addResourceSuppressions(logBucket, [
            { id: "AwsSolutions-S1", reason: "This is the log bucket" },
        ])

        // Create a bucket to be used to hold training data and trained models
        this.trainingBucket = new s3.Bucket(this, "training-models", {
            encryption: s3.BucketEncryption.S3_MANAGED,
            autoDeleteObjects: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            serverAccessLogsBucket: logBucket,
            serverAccessLogsPrefix: "training-models",
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            versioned: true
        })

        new ssm.StringParameter(this, "Parameter", {
            allowedPattern: ".*",
            description: "The bucket which holds data and ML models",
            parameterName: "/aik/data-bucket",
            stringValue: this.trainingBucket.bucketName,
            tier: ssm.ParameterTier.ADVANCED,
        })


        // Add VPC endpoints

        const addEndpoint = function (s: string) {
            self.vpc.addInterfaceEndpoint("ep-" + s.split(".").join("-"), {
                privateDnsEnabled: true,
                service: new ec2.InterfaceVpcEndpointService(
                    cdk.Fn.sub("com.amazonaws.${AWS::Region}." + s))
            })
        }

        addEndpoint("sagemaker.api")
        addEndpoint("sagemaker.runtime")
        addEndpoint("sts")
        addEndpoint("monitoring")
        addEndpoint("logs")
        addEndpoint("ecr.dkr")
        addEndpoint("ecr.api")

        const ec2SubnetIdExportName = "subnet-id"
        const ec2VpcIdExportName = "vpc-id"

        new cdk.CfnOutput(this, "vpcidout", {
            description: "VPC Id output export",
            value: this.vpc.vpcId,
            exportName: ec2VpcIdExportName,
        })

        new cdk.CfnOutput(this, "subnetidout", {
            description: "Subnet Id output export",
            value: this.vpc.privateSubnets[0].subnetId,
            exportName: ec2SubnetIdExportName
        })

        const sageMakerSGIdExportName = "sg-id"

        // Create the S3 bucket to hold the EMR bootstrap scripts
        const emrBootstrapBucket = new s3.Bucket(this, "emr-bootstrap", {
            encryption: s3.BucketEncryption.S3_MANAGED,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            serverAccessLogsPrefix: "emr-bootstrap",
            serverAccessLogsBucket: logBucket,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            versioned: true
        })

        // Deploy the EMR shell scripts to the bucket
        new BucketDeployment(this, "emr-boostrap-deploy", {
            destinationBucket: emrBootstrapBucket,
            sources: [Source.asset("source/emr-bootstrap")]
        })

        // Service catalog portfolio
        const portfolio = new sc.Portfolio(this, "sagemaker-emr-portfolio", {
            displayName: "SageMaker EMR Product Portfolio",
            providerName: "AWS",
        })

        const emrBucketExportName = "sagemaker-emr-bootstrap-bucket"

        // Export the name of the bucket
        new CfnOutput(this, "emr-bootstrap-bucket-out", {
            value: emrBootstrapBucket.bucketName,
            exportName: emrBucketExportName,
            description: "The name of the bucket where we put EMR bootstrap scripts"
        })



        const jobFlowRole = new iam.Role(this, "job-flow", {
            assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName(
                  "service-role/AmazonElasticMapReduceforEC2Role"),
                iam.ManagedPolicy.fromAwsManagedPolicyName(
                  "AmazonSSMManagedInstanceCore"
                )
            ],
            permissionsBoundary: permissionsBoundary
        })
        jobFlowRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "ssm:GetParameters",
                "ssm:GetParameter",
            ],
            resources: [
                cdk.Fn.sub("arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:*")
            ]
        }))
        NagSuppressions.addResourceSuppressions(jobFlowRole, [
            {
                id: "AwsSolutions-IAM4",
                reason: "We don't know the name of the resource that will be created later by the cloud formation stack so we have to use managed policy"
            }], true)
        NagSuppressions.addResourceSuppressions(jobFlowRole, [
            {
                id: "AwsSolutions-IAM5",
                reason: "The name of the SSM parameters are not know"
            }], true)

        emrBootstrapBucket.grantRead(jobFlowRole)

        const emrEc2RoleNameExportName = "emr-ec2-role-arn"
        new cdk.CfnOutput(this, "emr-ec2-role", {
            description: "The ec2 role of the EMR cluster used service catalog",
            value: jobFlowRole.roleName,
            exportName:  emrEc2RoleNameExportName
        })


        const serviceRole = new iam.CfnRole(this, "service-role", {
            assumeRolePolicyDocument: {
                Statement: [{
                    Action: [
                        "sts:AssumeRole"
                    ],
                    Effect: "Allow",
                    Principal: {
                        Service: [
                            "elasticmapreduce.amazonaws.com"
                        ]
                    }
                }],
                Version: "2012-10-17",
            },
            managedPolicyArns: [
                "arn:aws:iam::aws:policy/service-role/AmazonElasticMapReduceRole"
            ],
            path: "/",
            permissionsBoundary: permissionsBoundary.managedPolicyArn
        })
        NagSuppressions.addResourceSuppressions(serviceRole, [
            {
                id: "AwsSolutions-IAM4",
                reason: "We don't know the name of the resource that will be created later by the cloud formation stack so we have to use managed policy"
            }], true)
        const emrServiceRoleNameExportName = "emr-service-role-arn"
        new cdk.CfnOutput(this, "emr-service-role", {
            description: "The service role of the EMR cluster used service catalog",
            value: serviceRole.attrArn,
            exportName: emrServiceRoleNameExportName
        })

        const emrSecurityConfigurationName = "aik-emr-security-configuration"
        const ebsEncryptionKey = new kms.Key(this,'ebs-ebcryption-key', {
            alias: "aik/ebs",
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            pendingWindow: cdk.Duration.days(7),
            enabled: true,
            enableKeyRotation: true,
            admins: [new iam.AccountPrincipal(cdk.Stack.of(this).account)],
            policy: new iam.PolicyDocument({
                statements:[
                    new iam.PolicyStatement({
                        principals: [
                            new iam.ArnPrincipal(jobFlowRole.roleArn),
                            new iam.ArnPrincipal(serviceRole.attrArn)
                        ],
                        actions: [
                            "kms:Encrypt",
                            "kms:Decrypt",
                            "kms:ReEncrypt*",
                            "kms:GenerateDataKey*",
                            "kms:DescribeKey"
                        ],
                        resources: ["*"]
                    }),
                    new iam.PolicyStatement({
                        principals: [
                            new iam.ArnPrincipal(jobFlowRole.roleArn),
                            new iam.ArnPrincipal(serviceRole.attrArn)
                        ],
                        actions: [
                            "kms:CreateGrant",
                            "kms:ListGrants",
                            "kms:RevokeGrant"
                        ],
                        resources: ["*"],
                        conditions: {
                            "Bool": {
                                "kms:GrantIsForAWSResource": true
                            }
                        }
                    })
                ]
            })
        })




        const securityConfiguration =  {
            "EncryptionConfiguration": {
                "EnableInTransitEncryption": false,
                "EnableAtRestEncryption": true,
                "AtRestEncryptionConfiguration": {
                    "LocalDiskEncryptionConfiguration": {
                        "EnableEbsEncryption" : true,
                        "EncryptionKeyProviderType": "AwsKms",
                        "AwsKmsKey": ebsEncryptionKey.keyArn
                    }
                }
            }
        }
        new emr.CfnSecurityConfiguration(this, 'MyCfnSecurityConfiguration', {
            securityConfiguration: securityConfiguration,

            // the properties below are optional
            name: emrSecurityConfigurationName,
        });

        const emrSecurityConfigurationNameExportName = "emr-security-configuration-name"
        new cdk.CfnOutput(this, "emr-security-configuration-name", {
            description: "Name of the security configuration for the EMR cluster",
            value: emrSecurityConfigurationName,
            exportName:  emrSecurityConfigurationNameExportName
        })

        // Service catalog product
        const emrStackProps: EmrStackProps = {
            ec2SubnetIdExportName,
            ec2VpcIdExportName,
            sageMakerSGIdExportName,
            emrBucketExportName,
            emrEc2RoleNameExportName,
            emrServiceRoleNameExportName,
            emrSecurityConfigurationNameExportName
        }

        // TODO: EMR cluster auto shutdown after inactivity

        const emrStack = new EmrStack(this, "EmrProduct", emrStackProps)
        const template = sc.CloudFormationTemplate.fromProductStack(emrStack)
        const product = new sc.CloudFormationProduct(this, "sagemaker-emr-product", {
            productName: "SageMaker EMR Product",
            owner: "AWS",
            productVersions: [
                {
                    productVersionName: "v1",
                    cloudFormationTemplate: template,
                },
            ],
        })

        // This tag is what makes the template visible from SageMaker Studio
        cdk.Tags.of(product).add("sagemaker:studio-visibility:emr", "true")

        // Associate the product with the portfolio
        portfolio.addProduct(product)

        // Create the constraint role
        const constraint = createLaunchConstraint(this, permissionsBoundary)

        portfolio.setLaunchRole(product, constraint)

        const vpceSG = new ec2.SecurityGroup(this, id + "vpc-ep-sg", {
            description: "Allow TLS for VPC endpoint",
            vpc: this.vpc,
        })

        const smSG = new ec2.SecurityGroup(this, id + "sm-sg", {
            vpc: this.vpc
        })

        addIngress(this, "sm-sm", smSG, smSG, "-1", false)
        addIngress(this, "sm-smtcp", smSG, smSG, "tcp", false)
        addIngress(this, "sm-vpce", vpceSG, smSG, "-1", false)

        new cdk.CfnOutput(this, id + "smsgidout", {
            description: "SageMaker security group id output export",
            value: smSG.securityGroupId,
            exportName: sageMakerSGIdExportName
        })

        const smExecRole = createSagemakerExecutionRole(this, this.trainingBucket,permissionsBoundary)

        // Allow SageMaker to read and write SystemsManager ParameterStore
        smExecRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "ssm:PutParameter",
                "ssm:GetParameters",
                "ssm:GetParameter",
            ],
            resources: [
                cdk.Fn.sub("arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:*")
            ]
        }))

        // Allow SageMaker to access the training data bucket
        this.trainingBucket.grantReadWrite(smExecRole)

        // Principal association
        portfolio.giveAccessToRole(smExecRole)

        // SageMaker domain
        const domain = new sagemaker.CfnDomain(this, "domain", {
            appNetworkAccessType: "VpcOnly",
            authMode: "IAM",
            defaultUserSettings: {
                executionRole: smExecRole.roleArn,
                securityGroups: [smSG.securityGroupId],
            },
            domainName: "CDKSample",
            vpcId: this.vpc.vpcId,
            subnetIds: [this.vpc.privateSubnets[0].subnetId]
        })

        new cdk.CfnOutput(this, "efs-out", {
            value: domain.attrHomeEfsFileSystemId,
            description: "File system id to be deleted before the stack can be deleted"
        })

        // Custom resource to clean up automatically created security groups

        // Create the lambda handler for the resource
        const onEvent = new lambda.Function(this, "sagemaker-sg-cleanup-fn", {
            runtime: lambda.Runtime.NODEJS_16_X,
            code: lambda.Code.fromAsset("./build/source/sagemaker-sg-cleanup"),
            handler: "handler.handler",
            memorySize: 1536,
            timeout: cdk.Duration.minutes(5),
            description: "SageMaker security group cleanup",
            environment: {
                "VPC_ID": this.vpc.vpcId,
                "EFS_ID": domain.attrHomeEfsFileSystemId
            }
        })

        NagSuppressions.addResourceSuppressions(onEvent, [
            {
                id: "AwsSolutions-IAM4",
                reason: "CDK controls the policy, which is configured the way we need it to be"
            }], true)

        // Grant the lambda permissions to describe and delete vpc, efs
        onEvent.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: ["*"],
            actions: [
                "ec2:DescribeSecurityGroups",
                "ec2:DescribeSecurityGroupRules",
                "ec2:DeleteSecurityGroup",
                "ec2:DeleteNetworkInterface",
                "ec2:RevokeSecurityGroupIngress",
                "ec2:RevokeSecurityGroupEgress",
                "elasticfilesystem:DescribeMountTargets",
                "elasticfilesystem:DeleteMountTarget",
                "elasticfilesystem:DeleteFileSystem",
            ]
        }))

        NagSuppressions.addResourceSuppressions(onEvent, [
            {
                id: "AwsSolutions-IAM5",
                reason: "We need a '*' here because we are deleting resources that we did not create, so we don't control the names"
            }], true)


        // Create a provider
        const provider = new cr.Provider(this, "sagemaker-sg-cleanup-pr", {
            onEventHandler: onEvent
        })

        // Create the custom resource
        const customResource = new cdk.CustomResource(this, "sagemaker-sg-cleanup-cr", {
            serviceToken: provider.serviceToken
        })

        // Add a dependency on the domain so the lambda deletes first
        customResource.node.addDependency(domain)

        // Sagemaker user profile
        new sagemaker.CfnUserProfile(this, "user-profile", {
            domainId: domain.attrDomainId,
            userProfileName: "cdk-studio-user",
            userSettings: {
                executionRole: smExecRole.roleArn
            }
        })

    }
}
