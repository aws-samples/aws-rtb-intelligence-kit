import * as aws from "aws-sdk"

/**
 * Delete the security groups that Sagemaker creates for a domain to connect to EFS.
 * 
 * Ideally these would be deleted by the CloudFormation resource.
 * 
 * @param vpcId 
 */
export async function deleteSagemakerSecurityGroups(vpcId: string) {
    console.log("About to delete NFS security groups for ", vpcId)
    console.log("Region", process.env.AWS_REGION)
    const ec2 = new aws.EC2({
        region: process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION
    })
    const sgResult = await ec2.describeSecurityGroups({
        Filters: [
            {
                Name: "vpc-id", 
                Values: [vpcId]
            }
        ]
    }).promise()
    console.log({sgResult})
    const groupsToDelete = []
    if (sgResult.SecurityGroups) {
        for (const sg of sgResult.SecurityGroups) {
            console.log(sg)
            if (sg.VpcId === vpcId && sg.GroupName && sg.GroupId && (
                sg.GroupName.indexOf("outbound-nfs") > -1 ||
                sg.GroupName.indexOf("inbound-nfs") > -1)) {

                console.log(`Found sg ${sg.GroupId}`)
                groupsToDelete.push(sg)

                const ruleResult = await ec2.describeSecurityGroupRules({
                    Filters: [
                        {
                            Name: "group-id",
                            Values: [sg.GroupId]
                        }
                    ]
                }).promise()
               
                console.log(ruleResult.SecurityGroupRules)

                if (ruleResult.SecurityGroupRules) {
                    for (const r of ruleResult.SecurityGroupRules) {
                        if (r.IsEgress && r.SecurityGroupRuleId) {
                            await ec2.revokeSecurityGroupEgress({
                                GroupId: sg.GroupId, 
                                SecurityGroupRuleIds: [r.SecurityGroupRuleId]
                            }).promise()
                        } else if (r.SecurityGroupRuleId) {
                            await ec2.revokeSecurityGroupIngress({
                                GroupId: sg.GroupId, 
                                SecurityGroupRuleIds: [r.SecurityGroupRuleId]
                            }).promise()
                        }
                    }
                }
            }
        }

        // Now that the rules are all deleted, delete the groups
        for (const g of groupsToDelete) {
            await ec2.deleteSecurityGroup({
                GroupId: g.GroupId
            }).promise()
        }
    }
}