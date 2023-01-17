import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"
import {FilteringApplicationStack} from "./filtering-application-stack"
import { SagemakerEmrStack } from "./sagemaker-emr-stack"

/**
 * Advertising Intelligence Kit deployment stage.
 * 
 * This stage represents the entire app, which may be deployed to various 
 * environments such as local development accounts, beta, gamma, prod, etc.
 * 
 * This stage has the following stacks:
 *  - Networking
 *  - Filtering application
 *  - Sagemaker Studio and Service Catalog Product
 *  - EMR cluster (deployed from service catalog)
 */
export class AIKStage extends cdk.Stage {
    constructor(scope: Construct, id: string, props?: cdk.StageProps) {
        super(scope, id, props)

        // Create the SageMaker studio domain and the Service Catalog product
        // that allows analysts to create EMR clusters from their studio instance.
        const sagemakerEmr = new SagemakerEmrStack(this, "sagemaker-emr", {
            description: "(SO9127) Advertising Intelligence Kit - SageMaker and EMR stack (uksb-1tf424ncp)"
        })

        new FilteringApplicationStack(this, "filtering", {
            description: "Advertising Intelligence Kit - Filtering application stack",
            vpc : sagemakerEmr.vpc,
            trainingBucket: sagemakerEmr.trainingBucket
        })


    }
}
