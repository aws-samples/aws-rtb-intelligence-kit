import * as ec2 from "aws-cdk-lib/aws-ec2"
import { Construct } from "constructs"

// Helper function to create the roles, since it's very repetitive
export function addIngress(scope: Construct,
    name: string,
    toSecurityGroup: ec2.CfnSecurityGroup | string | ec2.SecurityGroup,
    fromSecurityGroup: ec2.CfnSecurityGroup | string | ec2.SecurityGroup,
    ipProtocol: string,
    reverse: boolean,
    fromPort?: number,
    toPort?: number) {

    if (fromPort === undefined) fromPort = 0
    if (toPort === undefined) toPort = 65535

    function getId(sg: ec2.CfnSecurityGroup | string | ec2.SecurityGroup): string {
        if (sg instanceof ec2.CfnSecurityGroup) return sg.ref
        if (sg instanceof ec2.SecurityGroup) return sg.securityGroupId
        return sg
    }

    // Delete the ingress rules before the security groups so we don't get stuck
    function depend(ing: ec2.CfnSecurityGroupIngress) {
        if (toSecurityGroup instanceof ec2.CfnSecurityGroup) {
            ing.addDependency(toSecurityGroup)
        }
        if (toSecurityGroup instanceof ec2.SecurityGroup) {
            ing.node.addDependency(toSecurityGroup)
        }
        if (fromSecurityGroup instanceof ec2.CfnSecurityGroup) {
            ing.addDependency(fromSecurityGroup)
        }
        if (fromSecurityGroup instanceof ec2.SecurityGroup) {
            ing.node.addDependency(fromSecurityGroup)
        }
    }

    const to = getId(toSecurityGroup)
    const from = getId(fromSecurityGroup)

    const in1 = new ec2.CfnSecurityGroupIngress(scope, name, {
        ipProtocol, fromPort, toPort,
        groupId: to, sourceSecurityGroupId: from,
    })

    depend(in1)

    if (reverse) {
        // Create the same ingress role in reverse
        const in2 = new ec2.CfnSecurityGroupIngress(scope, name + "-rev", {
            ipProtocol, fromPort, toPort,
            sourceSecurityGroupId: to, groupId: from,
        })

        depend(in2)
    }
}