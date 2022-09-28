import { deleteSagemakerSecurityGroups } from "../source/sagemaker-sg-cleanup/delete-sg"

(async function testDelete() {
    try {
        await deleteSagemakerSecurityGroups(process.argv[2])
    } catch (ex) {
        console.error(ex)
    }
})()