#!/usr/bin/env node
import "source-map-support/register"
import * as cdk from "aws-cdk-lib"
import { applyTags } from "../helpers/tags"
import { AIKStage } from "../lib/aik-stage"

const app = new cdk.App()

// This stage is meant to be deployed to local development environments.
// For production deployments, use CDK Pipelines.
const aik = new AIKStage(app, "aik")
applyTags(aik)

// If you want to deploy this kit to accounts as part of CI/CD, use CDK Pipelines 
// to instantiate an instance of each stage with hard-coded properties.
//
// For example, in your pipeline stack for your prod stage:
//
// const prodStage = new AIKStage(app, 'aik-stage', {
//   environment: 'production',
//   { PRODUCTION CONFIG VALUES HERE },
// });





