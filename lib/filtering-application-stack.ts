import * as cdk from "aws-cdk-lib"
import { RemovalPolicy } from "aws-cdk-lib"
import { Construct } from "constructs"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as iam from "aws-cdk-lib/aws-iam"
import * as path from "path"
import * as ssm from "aws-cdk-lib/aws-ssm"
import * as logs from "aws-cdk-lib/aws-logs"
import * as s3 from "aws-cdk-lib/aws-s3"
import monitoringConfig from "./monitoring-config.json"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import { NagSuppressions } from "cdk-nag"
import * as ecra from "aws-cdk-lib/aws-ecr-assets"



export interface FilteringStackProps extends cdk.StackProps {
    /**
     * A reference to the VPC where the MLflow application will be deployed
     */
    readonly vpc: ec2.IVpc;
    readonly trainingBucket: s3.IBucket;
}

/**
 * Creates the filtering application, which runs on ECS and handles inference.
 */
export class FilteringApplicationStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: FilteringStackProps) {
        super(scope, id)
        const vpc = props.vpc
        const trainingBucket = props.trainingBucket



        /**
         * ============================================================================
         * ========= IAM permission associated to the ad and fitering server ==========
         * ============================================================================
         */

        const filteringApplicationRole = new iam.Role( this, "FilteringApplicationRole", {
                assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy")
                ]
            }
        )

        trainingBucket.grantRead(filteringApplicationRole)





        /**
         * ============================================================================
         * ========= SSM Parameters used by the ad and fitering server ==========
         * ============================================================================
         */

        const monitoringConfigSSMParameter = new ssm.StringParameter(this, "MonitoringConfig", {
                description: "The configuration for CloudWatch agent",
                parameterName: "/aik/monitoring/config",
                stringValue: JSON.stringify(monitoringConfig),
                tier: ssm.ParameterTier.STANDARD,
            }
        )
        monitoringConfigSSMParameter.grantRead(filteringApplicationRole)

        const currentRegion = new ssm.StringParameter(this, "SSMParameterCurrentRegion", {
            description: "curent region where the stack is deployed",
            stringValue: cdk.Stack.of(this).region,
            parameterName: "/aik/current-region",
            tier: ssm.ParameterTier.STANDARD
        })
        currentRegion.grantRead(filteringApplicationRole)

        filteringApplicationRole.addToPolicy( new iam.PolicyStatement({
            actions: ["ssm:GetParameter"],
            resources:[
                `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/aik/xgboost/path`,
                `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/aik/pipelineModelArtifactPath`,
                `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/aik/pipelineModelArtifactSchemaPath`,
                `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/aik/inference_data`,

            ]
        }))

        NagSuppressions.addResourceSuppressions(filteringApplicationRole, [
            {
                id: "AwsSolutions-IAM4",
                reason: "CDK controls the policy, which is configured the way we need it to be (grantRead)"
            }], true)
        NagSuppressions.addResourceSuppressions(filteringApplicationRole, [
            {
                id: "AwsSolutions-IAM5",
                reason: "CDK controls the policy, which is configured the way we need it to be (grantRead)"
            }], true)
        /**
         * ================================================================
         * ========= TASK DEFINITION FOR AD SERVER and FILTERING ==========
         * ================================================================
         */

            // Create an ECS cluster
        const cluster = new ecs.Cluster(this, "Cluster", {
                vpc,
                clusterName: "advertising-server",
                containerInsights: true
            })

        const taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDef", {
            family: "adserver-application",
            cpu: 4096,
            memoryLimitMiB: 8192,
            taskRole: filteringApplicationRole
        })
        const imageServer = new ecs.AssetImage(path.join(__dirname, "../source/traffic-filtering-app/"), {
            file: "Dockerfile.Server",
            platform: ecra.Platform.LINUX_AMD64
        })
        const imageClient = new ecs.AssetImage(path.join(__dirname, "../source/traffic-filtering-app/"), {
            file: "Dockerfile.Client",
            platform: ecra.Platform.LINUX_AMD64
        })

        const advertisingServerLogGroup = new logs.LogGroup(this, "advertisingServerLogGroup", {
            logGroupName: "/aik/advertising-server",
            removalPolicy: RemovalPolicy.DESTROY
        })
        const filteringServerLogGroup = new logs.LogGroup(this, "filteringServerLogGroup", {
            logGroupName: "/aik/filtering-server",
            removalPolicy: RemovalPolicy.DESTROY
        })
        const monitoringLogGroup = new logs.LogGroup(this, "monitoringLogGroup", {
            logGroupName: "/aik/monitoring",
            removalPolicy: RemovalPolicy.DESTROY
        })

        /**
         * =================================================================
         * ========= Container defintion for the filtering server ==========
         * =================================================================
         */


        taskDefinition.addContainer("filtering-server", {
            containerName: "filtering-server",
            image: imageServer,
            memoryLimitMiB: 512,
            cpu: 1024,
            essential: true,
            user: "8000",
            portMappings: [
                { containerPort: 8080 },
            ],
            secrets: {
                AWS_REGION: ecs.Secret.fromSsmParameter(currentRegion)
            },
            logging: ecs.LogDriver.awsLogs({
                streamPrefix: "filtering-server",
                logGroup: filteringServerLogGroup
            })
        })

        NagSuppressions.addResourceSuppressions(cluster, [
            {
                id: "AwsSolutions-ECS7",
                reason: "Seems to be a false positive as were are configuring logs above"
            }
        ], true)

        /**
         * =========================================================
         * ========= Container defintion for the adserver ==========
         * =========================================================
         */
        taskDefinition.addContainer("advertising-server", {
            containerName: "advertising-server",
            image: imageClient,
            command: [
                "localhost", "1", "500000"
            ],
            memoryLimitMiB: 512,
            cpu: 1024,
            essential: false,
            secrets: {
                AWS_REGION: ecs.Secret.fromSsmParameter(currentRegion)
            },
            logging: ecs.LogDriver.awsLogs({
                streamPrefix: "advertising-server",
                logGroup: advertisingServerLogGroup
            }),
            user: "8000"
        })

        /**
         * =======================================================
         * ========= Container defintion for monitoring ==========
         * =======================================================
         */
        taskDefinition.addContainer("cloudwatch", {
            containerName: "cloudwatch",
            image: ecs.ContainerImage.fromRegistry("public.ecr.aws/cloudwatch-agent/cloudwatch-agent:latest"),
            memoryLimitMiB: 256,
            cpu: 256,
            essential: true,
            secrets: {
                CW_CONFIG_CONTENT: ecs.Secret.fromSsmParameter(monitoringConfigSSMParameter)
            },
            logging: ecs.LogDriver.awsLogs({
                streamPrefix: "cloudwatch-agent",
                logGroup: monitoringLogGroup
            })
        })


        // Instantiate an Amazon ECS Service
        new ecs.FargateService(this, "FilteringService", {
            cluster,
            taskDefinition,
            serviceName: "aik-application",
            maxHealthyPercent: 100,
            minHealthyPercent: 0,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
            },
            desiredCount: 1,

        })

        /**
         * ======================================
         * ========= Metric definition ==========
         * ======================================
         */
        const clientSideLatency = new cloudwatch.Metric({
            metricName: "adserver_client_adserver_latency_ms",
            namespace: "aik",
            unit: cloudwatch.Unit.MILLISECONDS,
            statistic: "p99",
            period: cdk.Duration.seconds(10),
            label: "Advertising server (client)",
            dimensionsMap: {
                metric_type: "timing"
            },



        })

        const clientSideMetricMs = new cloudwatch.MathExpression({
            expression: "mLatencyClientSide/1000",
            usingMetrics: {
                "mLatencyClientSide":clientSideLatency
            },
            label: "Advertising server (client)",
            color: cloudwatch.Color.ORANGE
        })
        const serverSideLatency = new cloudwatch.Metric({
            metricName: "filtering_server_filtering_latency",
            namespace: "aik",
            statistic: "p99",
            period: cdk.Duration.seconds(10),
            unit: cloudwatch.Unit.MILLISECONDS,
            label: "Filtering server (server)",
            dimensionsMap: {
                metric_type: "timing"
            }

        })
        const serverSideMetricMs = new cloudwatch.MathExpression({
            expression: "mLatencyServerSide/1000",
            usingMetrics: {
                "mLatencyServerSide":serverSideLatency
            },
            label: "Filtering server (server)",
            color: cloudwatch.Color.BLUE
        })
        const totalCountOver10s = new cloudwatch.Metric({
            metricName: "filtering_server_filtering_count",
            namespace: "aik",
            statistic: "sum",
            period: cdk.Duration.seconds(10),
            label: "Total number of bid requests over 10 seconds",
            dimensionsMap: {
                metric_type: "counter"
            }
        })
        const throughputOver10s = new cloudwatch.MathExpression({
            expression: "filtering_server_filtering_count_10s/10",
            usingMetrics: {
                "filtering_server_filtering_count_10s":totalCountOver10s
            },
            label: "Average throughput over 10s",
            color: cloudwatch.Color.BLUE
        })
        const totalTransaction = new cloudwatch.Metric({
            metricName: "filtering_server_filtering_count",
            namespace: "aik",
            statistic: "sum",
            period: cdk.Duration.minutes(30),
            label: "Total number of bid requests",
            dimensionsMap: {
                metric_type: "counter"
            }

        })
        const likelihoodToBid = new cloudwatch.Metric({
            metricName: "adserver_client_likelihood_to_bid",
            namespace: "aik",
            statistic: "average",
            period: cdk.Duration.seconds(10),
            label: "Likelihood to bid",
            dimensionsMap: {
                metric_type: "gauge"
            }

        })
        const dashboard = new cloudwatch.Dashboard(this, "FilteringDashboard", /* all optional props */ {
            dashboardName: "Monitoring-Dashboard",
            periodOverride: cloudwatch.PeriodOverride.INHERIT,
        })

        const latencyWidget = new cloudwatch.GraphWidget({

            view: cloudwatch.GraphWidgetView.TIME_SERIES,

            stacked: false,
            liveData: true,
            rightYAxis: {
                showUnits: false
            },
            leftYAxis: {
                showUnits: false,
                label: "Latency in ms",
            },
            title: "Filtering Latency (ms)",
            legendPosition: cloudwatch.LegendPosition.BOTTOM,
            right:[
                clientSideMetricMs,
                serverSideMetricMs
            ],
            period: cdk.Duration.seconds(10)
        })

        const throughputWidget = new cloudwatch.GraphWidget({

            view: cloudwatch.GraphWidgetView.TIME_SERIES,

            stacked: false,
            liveData: true,
            rightYAxis: {
                showUnits: false
            },
            leftYAxis: {
                showUnits: false,
                label: "query per second",
            },
            title: "Filtering request per second",
            legendPosition: cloudwatch.LegendPosition.BOTTOM,
            right:[
                throughputOver10s
            ],
            period: cdk.Duration.seconds(10)
        })

        const bidRequestWidget = new cloudwatch.SingleValueWidget({
            title: "Number of bid requests submitted",
            metrics:[totalTransaction]
        })
        const likelihoodWidget = new cloudwatch.GraphWidget({

            view: cloudwatch.GraphWidgetView.TIME_SERIES,

            stacked: false,
            liveData: true,
            rightYAxis: {
                showUnits: false
            },
            leftYAxis: {
                showUnits: false
            },
            title: "Likelihood analysis",
            legendPosition: cloudwatch.LegendPosition.BOTTOM,
            right:[
                likelihoodToBid
            ],
            period: cdk.Duration.seconds(10)
        })
        const row = new cloudwatch.Row(latencyWidget,throughputWidget,likelihoodWidget,bidRequestWidget)
        dashboard.addWidgets(row)

    }
}
