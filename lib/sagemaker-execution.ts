import * as iam from "aws-cdk-lib/aws-iam"
import * as s3 from "aws-cdk-lib/aws-s3"
import { NagSuppressions } from "cdk-nag"
import { Construct } from "constructs"
import * as cdk from "aws-cdk-lib"

/**
 * Create the role that SageMaker will use for user actions.
 * 
 * @param construct 
 * @returns 
 */
export function createSagemakerExecutionRole(construct:Construct, 
    trainingBucket: s3.IBucket,
    boundary: iam.ManagedPolicy): iam.Role {

    const smExecRole = new iam.Role(construct, "sm-exec", {
        assumedBy: new iam.ServicePrincipal("sagemaker.amazonaws.com"),
        managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSageMakerFullAccess"),
        ],
        permissionsBoundary: boundary
    })

    trainingBucket.grantReadWrite(smExecRole)

    smExecRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            "codecommit:GitPull",
            "codecommit:GitPush",
        ],
        resources: [
            cdk.Fn.sub("arn:aws:codecommit:${AWS::Region}:${AWS::AccountId}:notebooks")
        ]
    }))

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

    smExecRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            "elasticmapreduce:ListInstances",
            "elasticmapreduce:DescribeCluster",
            "elasticmapreduce:DescribeSecurityConfiguration",
            "elasticmapreduce:CreatePersistentAppUI",
            "elasticmapreduce:DescribePersistentAppUI",
            "elasticmapreduce:GetPersistentAppUIPresignedURL",
            "elasticmapreduce:GetOnClusterAppUIPresignedURL",
            "elasticmapreduce:ListClusters",
            "iam:CreateServiceLinkedRole",
            "iam:GetRole",
        ],
        resources: ["*"] 
    }))

    smExecRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["iam:PassRole"],
        resources: ["*"],
        conditions: {
            "StringEquals": {"iam:PassedToService": "sagemaker.amazonaws.com"}
        }
    }))

    smExecRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            "elasticmapreduce:DescribeCluster",
            "elasticmapreduce:ListInstanceGroups"],
        resources: [cdk.Fn.sub("arn:${AWS::Partition}:elasticmapreduce:*:*:cluster/*")]
    }))

    smExecRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            "elasticmapreduce:ListClusters"],
        resources: ["*"]
    }))

    NagSuppressions.addResourceSuppressions(smExecRole, [
        { 
            id: "AwsSolutions-IAM4", 
            reason: "Domain users require full access and the managed policy is likely better than '*'"
        },
        { 
            id: "AwsSolutions-IAM5", 
            reason: "The resources have not been created yet so we can't refer to them here"
        }
    ], true)

    return smExecRole
}