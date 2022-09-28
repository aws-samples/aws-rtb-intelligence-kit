import {Stack, StackProps} from "aws-cdk-lib"
import {IVpc} from "aws-cdk-lib/aws-ec2"
import {Construct} from "constructs"
import {ProductConstruct} from "./product-construct"
import {IBucket} from "aws-cdk-lib/aws-s3";

/**
 * This stack deploys a VPC, a SageMaker domain, and a ServiceCatalog product.
 * 
 * The Service Catalog product allows SageMaker studio users to deploy an EMR
 * cluster with sample data to demonstrate interacting with the cluster from 
 * SageMaker studio.
 */
export class SagemakerEmrStack extends Stack {

    public vpc: IVpc
    public trainingBucket: IBucket

    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props)

        const product = new ProductConstruct(this, "sagemaker-emr-product")

        this.vpc = product.vpc
        this.trainingBucket = product.trainingBucket
    }
}
