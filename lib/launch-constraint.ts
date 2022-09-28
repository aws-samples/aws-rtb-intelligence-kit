import * as iam from "aws-cdk-lib/aws-iam"
import { NagSuppressions } from "cdk-nag"
import { Construct } from "constructs"

/**
 * Create the launch constraint roles that will be used by Service Catalog 
 * when a user provisions the EMR product.
 * 
 * @param construct 
 */
export function createLaunchConstraint(construct: Construct, boundary: iam.ManagedPolicy): iam.Role {

    // Launch constraint - this is the role that is assumed when a Studio user
    // clicks on the button to create a new EMR cluster
    const constraint = new iam.Role(construct, "launch-constraint", {
        assumedBy: new iam.ServicePrincipal("servicecatalog.amazonaws.com"),
        managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName("AWSServiceCatalogAdminFullAccess"),
            iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEMRFullAccessPolicy_v2"),
        ],
        permissionsBoundary: boundary
    })

    constraint.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:*"],
        resources: ["*"]
    }))

    constraint.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["sns:Publish"],
        resources: ["*"]
    }))

    constraint.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            "ec2:CreateSecurityGroup",
            "ec2:RevokeSecurityGroupEgress",
            "ec2:DeleteSecurityGroup",
            "ec2:createTags",
            "ec2:AuthorizeSecurityGroupEgress",
            "ec2:AuthorizeSecurityGroupIngress",
            "ec2:RevokeSecurityGroupIngress"
        ],
        resources: ["*"]
    }))

    constraint.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            "lambda:CreateFunction",
            "lambda:InvokeFunction",
            "lambda:DeleteFunction",
            "lambda:GetFunction"],
        resources: ["*"] // TODO - Limit with a tag?
    }))

    constraint.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["elasticmapreduce:RunJobFlow"],
        resources: ["*"]
    }))

    constraint.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            "iam:CreateRole",
            "iam:DetachRolePolicy",
            "iam:AttachRolePolicy",
            "iam:DeleteRolePolicy",
            "iam:DeleteRole",
            "iam:PutRolePolicy",
            "iam:PassRole",
            "iam:CreateInstanceProfile",
            "iam:RemoveRoleFromInstanceProfile",
            "iam:DeleteInstanceProfile",
            "iam:AddRoleToInstanceProfile"
        ],
        resources: ["*"]
    }))

    constraint.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            "cloudformation:CreateStack",
            "cloudformation:DeleteStack",
            "cloudformation:DescribeStackEvents",
            "cloudformation:DescribeStacks",
            "cloudformation:GetTemplateSummary",
            "cloudformation:SetStackPolicy",
            "cloudformation:ValidateTemplate",
            "cloudformation:UpdateStack",
        ],
        resources: ["*"]
    }))

    NagSuppressions.addResourceSuppressions(constraint, [
        { 
            id: "AwsSolutions-IAM4", 
            reason: "Provisioning this product requires full access and the managed policy is likely better than '*'"
        },
        { 
            id: "AwsSolutions-IAM5", 
            reason: "The resources have not been created yet so we can't refer to them here"
        }
    ], true)

    return constraint
}