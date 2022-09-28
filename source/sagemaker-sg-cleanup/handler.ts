// import * as ec2 from "@aws-sdk/client-ec2"
import * as aws from "aws-sdk"
import { deleteSagemakerSecurityGroups } from "./delete-sg"

/**
 * Handle requests from 
 * @param evt 
 */
exports.handler = async (evt: any): Promise<any> => {
    console.log(evt)

    const requestType = evt.RequestType

    const vpcId = process.env["VPC_ID"]
    console.info({ vpcId })

    const efsId = process.env["EFS_ID"]
    console.info({ efsId })

    if (!vpcId) {
        throw new Error("VPC_ID not defined")
    }

    if (!efsId) {
        throw new Error("EFS_ID not defined")
    }

    if (requestType === "Create" || requestType === "Update") {

        // We don't do anything for create or update
        return { "PhysicalResourceId": "N/A" }

    } else if (requestType == "Delete") {

        // Delete the file system created for the SageMaker domain
        try {
            console.log(`About to delete file system ${efsId}`)
            const efs = new aws.EFS()
            const mountTargets = await efs.describeMountTargets({
                FileSystemId: efsId
            }).promise()
            if (mountTargets.MountTargets) {
                for (const t of mountTargets.MountTargets) {
                    await efs.deleteMountTarget({
                        MountTargetId: t.MountTargetId
                    }).promise()

                    // The DeleteMountTarget call returns while the mount target state 
                    // is still deleting. You can check the mount target deletion by 
                    // calling the DescribeMountTargets operation, which returns a list of 
                    // mount target descriptions for the given file system. 

                    let remainingTargets
                    let deleting = true
                    const maxTries = 10
                    let currentTry = 0
                    console.log("About to wait for mount target to be deleted")
                    do {
                        currentTry += 1
                        await new Promise(r => setTimeout(r, 5000))
                        remainingTargets = await efs.describeMountTargets({
                            FileSystemId: efsId
                        }).promise()
                        console.log({ remainingTargets })
                        let sawIt = false
                        if (remainingTargets.MountTargets) {
                            for (const stillThere of remainingTargets.MountTargets) {
                                if (stillThere.MountTargetId == t.MountTargetId) {
                                    sawIt = true
                                }
                            }
                        }
                        if (!sawIt) deleting = false
                    } while (deleting && currentTry < maxTries)
                }
            }
            await efs.deleteFileSystem({
                FileSystemId: efsId
            }).promise()
        } catch (ex) {
            console.error(ex)
        }

        // SageMaker automatically adds a security group to allow access to NFS.
        // https://awscli.amazonaws.com/v2/documentation/api/latest/reference/sagemaker/create-domain.html
        // This makes it impossible to delete the stack...
        // Adding these rules manually does not prevent SageMaker from creating them
        // This custom resource handler deletes the security groups
        // Names: 
        // security-group-for-outbound-nfs-d-lhtklclyyvsw
        // security-group-for-inbound-nfs-d-lhtklclyyvsw

        try {
            console.log(`About to delete NFS security groups from VPC ${vpcId}`)
            await deleteSagemakerSecurityGroups(vpcId)
        } catch (ex) {
            console.error(ex)
        }
    }
}



// /**
//  * For reference, here's the JS SDK V3 code. It's not available by default on Lambda, 
//  * and we'd have to do some bundling to package it up, so we went back to v2.
//  */
// async function v3() {
//     (async () => {
//         try {
//             const client = new ec2.EC2Client({})
//             const command = new ec2.DescribeSecurityGroupsCommand({
//                 Filters: [
//                     {
//                         Name: "vpc-id", 
//                         Values: [vpcId]
//                     }
//                 ]
//             })
//             const results = await client.send(command)
//             console.log(results)

//             if (results.SecurityGroups) {
//                 for (const result of results.SecurityGroups) {
//                     console.log(result)
//                     const groupName = result.GroupName || ""
//                     if (groupName.indexOf("outbound-nfs") > -1 || 
//                         groupName.indexOf("inbound-nfs") > -1) {
//                         console.log(`Deleting ${groupName}`)
//                         await client.send(new ec2.DeleteSecurityGroupCommand({
//                             GroupId: result.GroupId
//                         }))
//                     }
//                 }
//             }

//         } catch (err) {
//             console.error(err)
//         }
//     })()
// }
