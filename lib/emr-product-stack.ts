import { Construct } from "constructs"
import * as sc from "@aws-cdk/aws-servicecatalog-alpha"
import * as cdk from "aws-cdk-lib"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as emr from "aws-cdk-lib/aws-emr"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as iam from "aws-cdk-lib/aws-iam"
import { addIngress } from "./add-ingress"
import { Fn } from "aws-cdk-lib"

/**
 * Configurable properties for the EMR stack
 * 
 * We can't just use object references to refer to values in the main stack, 
 * since this stack is deployed to Service Catalog as a template.
 * 
 */
export interface EmrStackProps extends cdk.StackProps {
    ec2SubnetIdExportName: string,
    ec2VpcIdExportName: string,
    sageMakerSGIdExportName: string,
    emrBucketExportName: string,
    emrEc2RoleNameExportName: string,
    emrServiceRoleNameExportName: string
    emrSecurityConfigurationNameExportName: string
}

/**
 * This stack will be configured as the stack created by the ServiceCatalog 
 * product. Normally we would reference a CloudFormation template URL when we 
 * create a product, but the `ProductStack` class allows us to define it in CDK.
 * 
 * Adapted from the template in this blog post:
 * 
 * https://aws.amazon.com/blogs/machine-learning/part-1-create-and-manage-amazon-emr-clusters-from-sagemaker-studio-to-run-interactive-spark-and-ml-workloads/
 */
export class EmrStack extends sc.ProductStack {
    constructor(scope: Construct, id: string, props: EmrStackProps) {
        super(scope, id)

        // Parameters - normally we would not use CloudFormation parameters in
        // a CDK app, but they are required for ServiceCatalog to allow users
        // to configure products.

        const cfnParams = [
            {
                name: "SageMakerProjectName", 
                type: "String",
                description: "Name of the project",
            },
            {
                name: "SageMakerProjectId", 
                type: "String",
                description: "Service generated Id of the project",
            },
            {
                name: "EmrClusterName", 
                type: "String",
                description: "EMR cluster Name",
            },
            {
                name: "MainInstanceType", 
                type: "String",
                description: "Instance type of the EMR main node",
                default: "m5.xlarge", 
                allowedValues: [
                    "m5.xlarge",
                    "m5.2xlarge",
                    "m5.4xlarge",
                ]
            },
            {
                name: "CoreInstanceType", 
                type: "String",
                description: "Instance type of the EMR core nodes",
                default: "m5.xlarge", 
                allowedValues: [
                    "m5.xlarge",
                    "m5.2xlarge",
                    "m5.4xlarge",
                    "m3.medium",
                    "m3.large",
                    "m3.xlarge",
                    "m3.2xlarge",
                ]
            },
            {
                name: "CoreInstanceCount", 
                type: "String",
                description: "Number of core instances in the EMR cluster",
                default: "2", 
                allowedValues: ["2", "5", "10"]
            },
            {
                name: "EmrReleaseVersion", 
                type: "String",
                description: "The release version of EMR to launch",
                default: "emr-6.4.0",
                allowedValues: ["emr-6.4.0"]
            },
            {
                name: "AutoTerminationIdleTimout",
                type: "String",
                description: "Specifies the amount of idle time in seconds after which the cluster automatically terminates. You can specify a minimum of 60 seconds and a maximum of 604800 seconds (seven days).",
                default: "3600",
                allowedPattern: ["(6[0-9]|[7-9][0-9]|[1-9][0-9]{2,4}|[1-5][0-9]{5}|60[0-3][0-9]{3}|604[0-7][0-9]{2}|604800)"] 
            }
        ]

        const emrSecurityConfigurationName  = Fn.importValue(props.emrSecurityConfigurationNameExportName)
        const jobFlowRoleName  = Fn.importValue(props.emrEc2RoleNameExportName)
        const emrServiceRoleName = Fn.importValue(props.emrServiceRoleNameExportName)

        // NOTE: There is a bug in the SageMaker UI when choosing a template for the cluster, 
        // which prevents us from using "Number" parameter types.
       
        const cfnParamMap = new Map<string, cdk.CfnParameter>()
        for (const p of cfnParams) {

            // Create the parameter and associate it with this stack
            const cfnp = new cdk.CfnParameter(this, p.name, {
                type: p.type, 
                description: p.description, 
                default: p.default,
                allowedValues: p.allowedValues
            })

            // Add the parameter to a map so we can look it up later
            cfnParamMap.set(p.name, cfnp)
        }

        // This bucket was created by the parent stack and holds bootstrap scripts
        const sourceBucket = s3.Bucket.fromBucketAttributes(this, "source-bucket", {
            bucketName: Fn.importValue(props.emrBucketExportName)
        })

        // VPC reference

        // Security groups - we're using the L1 CfnSecurityGroup since it allows
        // us to only pass the VPC Id, otherwise we would need to import the 
        // VPC, but we can't since this stack is deployed by Service Catalog

        // EMR Main SG
        const mainSG = new ec2.CfnSecurityGroup(this, "main-sg", {
            groupDescription: "SageMaker EMR Cluster Main",
            vpcId: cdk.Fn.importValue(props.ec2VpcIdExportName),
        })

        // EMR Core SG
        const coreSG = new ec2.CfnSecurityGroup(this, "core-sg", {
            groupDescription: "SageMaker EMR Cluster Core",
            vpcId: cdk.Fn.importValue(props.ec2VpcIdExportName),
        })

        // EMR Service SG
        const svcSG = new ec2.CfnSecurityGroup(this, "svc-sg", {
            groupDescription: "SageMaker EMR Cluster Service",
            vpcId: cdk.Fn.importValue(props.ec2VpcIdExportName),
        })

        // Ingress rules

        // TODO: An EMR L2 construct could hide all of these ingress rules, which 
        // need to be exactly correct or you don't find out until runtime, which 
        // makes for a lot of time consuming trial and error when using the L1.

        const sageMakerSGId = cdk.Fn.importValue(props.sageMakerSGIdExportName)
    
        // These 3 get added automatically if missing, which makes it 
        // impossible to delete the stack if we don't add them explicitly
        addIngress(this, "main-core-8443", mainSG, coreSG, "tcp", true, 8443, 8443)
        addIngress(this, "main-svc-8443", mainSG, svcSG, "tcp", true, 8443, 8443)
        addIngress(this, "core-svc-8443", coreSG, svcSG, "tcp", true, 8443, 8443)

        addIngress(this, "main-main-icmp", mainSG, mainSG, "icmp", true, -1, -1)
        addIngress(this, "main-core-icmp", mainSG, coreSG, "icmp", true, -1, -1)
        addIngress(this, "main-main-tcp", mainSG, mainSG, "tcp", true)
        addIngress(this, "main-core-tcp", mainSG, coreSG, "tcp", true)
        addIngress(this, "main-main-udp", mainSG, mainSG, "udp", true)
        addIngress(this, "main-core-udp", mainSG, coreSG, "udp", true)

        addIngress(this, "main-livy", mainSG, coreSG, "tcp", true, 8998, 8998)
        addIngress(this, "sm-livy-main", mainSG, sageMakerSGId, "tcp", true, 8998, 8998)
        addIngress(this, "sm-livy-core", coreSG, sageMakerSGId, "tcp", true, 8998, 8998)
        addIngress(this, "main-hive", mainSG, coreSG, "tcp", true, 10000, 10000)
        addIngress(this, "main-svc", mainSG, svcSG, "tcp", true)
        addIngress(this, "scv-main-9443", svcSG, mainSG, "tcp", true, 9443, 9443)

        addIngress(this, "main-kdc", coreSG, sageMakerSGId, "tcp", false, 88, 88)
        addIngress(this, "main-kdcadmin", coreSG, sageMakerSGId, "tcp", false, 749, 749)
        addIngress(this, "main-kdcinit", coreSG, sageMakerSGId, "tcp", false, 464, 464)


        const jobFlowInstanceProfile = new iam.CfnInstanceProfile(this, 
            "job-flow-profile", {
                roles: [jobFlowRoleName],
                path: "/",
            })


        // EMR Cluster - there is no L2 support for this yet
        const emrCluster = new emr.CfnCluster(this, "cluster", {
            name: cfnParamMap.get("EmrClusterName")?.valueAsString || "",
            applications: [
                {
                    name: "Spark"
                }, 
                {
                    name: "Hive"
                },
                {
                    name: "Livy"
                }
            ],
            bootstrapActions: [ 
                {
                    name: "Dummy bootstrap action", 
                    scriptBootstrapAction: {
                        args: ["dummy", "parameter"],
                        path: cdk.Fn.sub("s3://${SampleDataBucket}/installpylibs.sh", {
                            "SampleDataBucket": sourceBucket.bucketName
                        })
                    }
                }
            ],
            autoScalingRole: "EMR_AutoScaling_DefaultRole",
            configurations: [ 
                {
                    classification: "livy-conf",
                    configurationProperties: { "livy.server.session.timeout": "2h" },
                }
            ],
            ebsRootVolumeSize: 100,
            instances: {
                coreInstanceGroup: {
                    instanceCount: 2, // We will manually hack this later to get around the SageMaker UI bug
                    //instanceCount: cfnParamMap.get("CoreInstanceCount")?.valueAsNumber || 2,
                    instanceType: cfnParamMap.get("CoreInstanceType")?.valueAsString || "m5.xlarge",
                    ebsConfiguration: {
                        ebsBlockDeviceConfigs: [
                            {
                                volumeSpecification: {
                                    sizeInGb: 320,
                                    volumeType: "gp2",
                                },
                            },
                        ],
                        ebsOptimized: true,
                    },
                    market: "ON_DEMAND",
                    name: "coreNode",
                },
                masterInstanceGroup: {
                    instanceCount: 1,
                    instanceType: cfnParamMap.get("CoreInstanceType")?.valueAsString || "m5.xlarge",
                    ebsConfiguration: {
                        ebsBlockDeviceConfigs: [
                            {
                                volumeSpecification: {
                                    sizeInGb: 320,
                                    volumeType: "gp2",
                                },
                            },
                        ],
                        ebsOptimized: true,
                    },
                    market: "ON_DEMAND",
                    name: "mainNode",
                },
                terminationProtected: false,
                ec2SubnetId: cdk.Fn.importValue(props.ec2SubnetIdExportName),
                emrManagedMasterSecurityGroup: mainSG.ref,
                emrManagedSlaveSecurityGroup: coreSG.ref,
                serviceAccessSecurityGroup: svcSG.ref,
            },
            jobFlowRole: jobFlowInstanceProfile.ref,
            serviceRole: emrServiceRoleName,
            logUri: cdk.Fn.sub("s3://${SampleDataBucket}/logging/", {
                "SampleDataBucket": sourceBucket.bucketName
            }),
            releaseLabel: cfnParamMap.get("EmrReleaseVersion")?.valueAsString || "",
            visibleToAllUsers: true,
            securityConfiguration: emrSecurityConfigurationName,
            autoTerminationPolicy: {
                idleTimeout: Number(cfnParamMap.get("AutoTerminationIdleTimout")?.valueAsString) || 3600,
            },
            steps: [
                {
                    actionOnFailure: "CONTINUE",
                    hadoopJarStep: {
                        args: [cdk.Fn.sub("s3://${SampleDataBucket}/configurekdc.sh", {
                            "SampleDataBucket": sourceBucket.bucketName
                        })],
                        jar: cdk.Fn.sub("s3://${AWS::Region}.elasticmapreduce/libs/script-runner/script-runner.jar", {}),
                        mainClass: ""
                    },
                    name: "run any bash or java job in spark",
                }
            ]
        })

        // Use escape hatches to hack the core instance count
        emrCluster.addOverride("Properties.Instances.CoreInstanceGroup.InstanceCount", 
            cfnParamMap.get("CoreInstanceCount")?.valueAsString || "2")

        emrCluster.node.addDependency(jobFlowInstanceProfile)

        // Note: It would be great if the EMR team deprecated the master/slave terminology.
        // Trying to avoid using those terms where we have a choice, preferring main and core.

        // TODO: Cleanup bucket function: Since we can't use assets with ServiceCatalog products, 
        // and the new S3 L2 auto delete functionality deploys a Lambda function.
        // We need to add the bucket cleanup function from the original templates.
        // Whether to delete the bucket or not should be configurable.
        
        new cdk.CfnOutput(this, "emr-main-dns-name-output", {
            description: "DNS Name of the EMR Master Node",
            value: emrCluster.attrMasterPublicDns,
        })
    }
}