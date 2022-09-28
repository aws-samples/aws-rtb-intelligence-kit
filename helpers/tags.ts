import * as cdk from "aws-cdk-lib"
import { IConstruct } from "constructs"

/**
 * Applies default tags to the given construct.
 */
export const applyTags = (c: IConstruct) => {
    cdk.Tags.of(c).add("Project", "advertising-intelligence-kit")
}
