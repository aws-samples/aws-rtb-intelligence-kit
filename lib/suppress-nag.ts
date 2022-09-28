import { Stack } from "aws-cdk-lib"
import { NagSuppressions } from "cdk-nag"

/**
 * Suppress cdk-nag warnings.
 * 
 * @param stack 
 */
export function suppressNag(stack:Stack) {

    NagSuppressions.addResourceSuppressionsByPath(stack,
        "/sagemaker-emr/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/ServiceRole/DefaultPolicy/Resource",
        [
            {
                id: "AwsSolutions-IAM4",
                reason: "Controlled by CDK L2 Construct"
            },
            {
                id: "AwsSolutions-IAM5",
                reason: "Controlled by CDK L2 Construct"
            }
        ])

    NagSuppressions.addResourceSuppressionsByPath(stack,
        "/sagemaker-emr/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/ServiceRole/Resource",
        [
            {
                id: "AwsSolutions-IAM4",
                reason: "Controlled by CDK L2 Construct"
            },
            {
                id: "AwsSolutions-IAM5",
                reason: "Controlled by CDK L2 Construct"
            }
        ])

    NagSuppressions.addResourceSuppressionsByPath(stack,
        "/sagemaker-emr/sagemaker-emr-product/sagemaker-sg-cleanup-pr/framework-onEvent/ServiceRole/Resource",
        [
            {
                id: "AwsSolutions-IAM4",
                reason: "Controlled by CDK L2 Construct"
            },
            {
                id: "AwsSolutions-IAM5",
                reason: "Controlled by CDK L2 Construct"
            }
        ])

    NagSuppressions.addResourceSuppressionsByPath(stack,
        "/sagemaker-emr/sagemaker-emr-product/sagemaker-sg-cleanup-pr/framework-onEvent/ServiceRole/DefaultPolicy/Resource",
        [
            {
                id: "AwsSolutions-IAM5",
                reason: "Controlled by CDK L2 Construct",
                appliesTo: ["Resource::<sagemakeremrproductsagemakersgcleanupfn94B3D97D.Arn>:*"]
            }
        ])

    NagSuppressions.addResourceSuppressionsByPath(stack,
        "/sagemaker-emr/sagemaker-emr-product/sagemaker-sg-cleanup-pr/framework-onEvent/Resource",
        [
            {
                id: "AwsSolutions-L1",
                reason: "Controlled by CDK L2 Construct"
            }
        ])

    NagSuppressions.addResourceSuppressionsByPath(stack,
        "/sagemaker-emr/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/Resource",
        [
            {
                id: "AwsSolutions-L1",
                reason: "Controlled by CDK L2 Construct"
            }
        ])
}
