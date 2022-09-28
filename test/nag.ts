#!/usr/bin/env node

// This file exists because cdk-nag doesn't work on stages.
// We need to synthesize the stacks at the top level to run nag checks.

import "source-map-support/register"
import * as cdk from "aws-cdk-lib"
import { applyTags } from "../helpers/tags"
import { Aspects } from "aws-cdk-lib"
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag"
import { SagemakerEmrStack } from "../lib/sagemaker-emr-stack"
import { FilteringApplicationStack } from "../lib/filtering-application-stack"
import { suppressNag } from "../lib/suppress-nag"

/**
 * Create an app with our stacks directly instantiated.
 */
function main() {
    const app = new cdk.App()
    const sagemakerEmr = new SagemakerEmrStack(app, "sagemaker-emr", {})
    suppressNag(sagemakerEmr)
    const filteringStack = new FilteringApplicationStack(app, "filtering", {
        trainingBucket: sagemakerEmr.trainingBucket,
        vpc : sagemakerEmr.vpc,
    })
    NagSuppressions.addResourceSuppressionsByPath(filteringStack,
        "/filtering/TaskDef/ExecutionRole/DefaultPolicy/Resource",
        [{
            id: "AwsSolutions-IAM5",
            reason: "False positive: policy is created as part of the intanciation of the construct", 
            appliesTo: ["Resource::*"]
        }],
        true)
    applyTags(app)
    Aspects.of(app).add(new AwsSolutionsChecks({
        verbose: true,
        logIgnores: false, 
        reports: true
    }))
    NagSuppressions.addStackSuppressions(sagemakerEmr, [
        {"id": "CdkNagValidationFailure", reason: "Nag can't parse Fn::"}
    ])

    app.synth()
}

main()
