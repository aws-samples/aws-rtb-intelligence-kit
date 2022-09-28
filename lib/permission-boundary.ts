import { Aws, Names } from "aws-cdk-lib"
import * as iam from "aws-cdk-lib/aws-iam"
import { NagSuppressions } from "cdk-nag"
import { Construct } from "constructs"

/**
 * Create a permissions boundary that must be applied to all IAM roles and users created by this deployment and by Service Catalog.
 * This permissions boundary is used to avoid unintended permission escalation.
 *
 * @param construct The parent construct that is the scope of the created permissions boundary.
 */
export function createPermissionsBoundary(construct: Construct): iam.ManagedPolicy {
    const boundaryPolicyName = `PermissionBoundary${Names.uniqueId(construct)}`
    const boundaryPolicyArn = `arn:aws:iam::${Aws.ACCOUNT_ID}:policy/${boundaryPolicyName}`

    const boundary = new iam.ManagedPolicy(construct, "global-permissions-boundary", {
        managedPolicyName: boundaryPolicyName,
        statements: [
            // disable access to cost and billing
            new iam.PolicyStatement({
                effect: iam.Effect.DENY,
                actions: [
                    "account:*",
                    "aws-portal:*",
                    "savingsplans:*",
                    "cur:*",
                    "ce:*"],
                resources: ["*"],
            }),

            // disable permissions boundary policy edit
            new iam.PolicyStatement({
                effect: iam.Effect.DENY,
                actions: [
                    "iam:DeletePolicy",
                    "iam:DeletePolicyVersion",
                    "iam:CreatePolicyVersion",
                    "iam:SetDefaultPolicyVersion"],
                resources: [boundaryPolicyArn],
            }),

            // disable removal of permissions boundary from a user/role
            new iam.PolicyStatement({
                effect: iam.Effect.DENY,
                actions: [
                    "iam:DeleteUserPermissionsBoundary",
                    "iam:DeleteRolePermissionsBoundary"],
                resources: [
                    `arn:aws:iam::${Aws.ACCOUNT_ID}:user/*`,
                    `arn:aws:iam::${Aws.ACCOUNT_ID}:role/*`
                ],
                conditions: {
                    "StringEquals": {
                        "iam:PermissionsBoundary": boundaryPolicyArn
                    }
                }
            }),

            // disable assigning a different permissions boundary
            new iam.PolicyStatement({
                effect: iam.Effect.DENY,
                actions: [
                    "iam:PutUserPermissionsBoundary",
                    "iam:PutRolePermissionsBoundary"],
                resources: [
                    `arn:aws:iam::${Aws.ACCOUNT_ID}:user/*`,
                    `arn:aws:iam::${Aws.ACCOUNT_ID}:role/*`
                ],
                conditions: {
                    "StringNotEquals": {
                        "iam:PermissionsBoundary": boundaryPolicyArn
                    }
                }
            }),

            // disable creating users/roles without the required permissions boundary
            new iam.PolicyStatement({
                effect: iam.Effect.DENY,
                actions: [
                    "iam:CreateUser",
                    "iam:CreateRole"],
                resources: [
                    `arn:aws:iam::${Aws.ACCOUNT_ID}:user/*`,
                    `arn:aws:iam::${Aws.ACCOUNT_ID}:role/*`
                ],
                conditions: {
                    "StringNotEquals": {
                        "iam:PermissionsBoundary": boundaryPolicyArn
                    }
                }
            }),

            // only allow passing this account's roles to select services
            new iam.PolicyStatement({
                effect: iam.Effect.DENY,
                actions: ["iam:PassRole"],
                resources: [`arn:aws:iam::${Aws.ACCOUNT_ID}:role/*`],
                conditions: {
                    "StringNotEquals": {
                        "iam:PassedToService": [
                            "ec2.amazonaws.com",
                            "elasticmapreduce.amazonaws.com",
                            "application-autoscaling.amazonaws.com",
                            "servicecatalog.amazonaws.com",
                            "sagemaker.amazonaws.com"
                        ]
                    }
                }
            }),

            // default - full access
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["*"],
                resources: ["*"],
            })
        ],
    })

    NagSuppressions.addResourceSuppressions(boundary, [
        {
            id: "AwsSolutions-IAM5",
            reason: "We need to grant the role passing permission, but we don't know the role ARNs at this point since it's a permission boundary"
        }
    ], false)

    return boundary
}
