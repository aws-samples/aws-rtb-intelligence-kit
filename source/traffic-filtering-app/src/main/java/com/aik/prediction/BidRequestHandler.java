// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

package com.aik.prediction;

import com.aik.filterapi.BidRequest;
import com.aik.filterapi.BidRequestFilter;
import com.aik.filterapi.BidResponse;
import com.timgroup.statsd.NonBlockingStatsDClient;
import com.timgroup.statsd.StatsDClient;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import software.amazon.awssdk.services.ssm.SsmClient;
import software.amazon.awssdk.services.ssm.model.GetParameterRequest;
import software.amazon.awssdk.services.ssm.model.GetParameterResponse;
import software.amazon.awssdk.services.ssm.model.SsmException;

import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;


public class BidRequestHandler implements BidRequestFilter.Iface {

    private static final Logger logger = LogManager.getLogger(BidRequestHandler.class.getName());
    private static final StatsDClient statsd = new NonBlockingStatsDClient("filtering_server", "localhost", 8125);
    private static final DoubleSummaryStatistics totalStats = new DoubleSummaryStatistics();
    private final BiddingFilter filter;
    private String filteringModelSsmParameterName;
    private String transformationModelSsmParameterName;
    private String transformationModelSchemaSsmParameterName;


    public BidRequestHandler() {
        filter = new BiddingFilter();
    }

    public void init() {
        logger.traceEntry();
        int metricsIntervalMs = 20000;

        filteringModelSsmParameterName = "/aik/xgboost/path" ;
        transformationModelSsmParameterName = "/aik/pipelineModelArtifactPath" ;
        transformationModelSchemaSsmParameterName = "/aik/pipelineModelArtifactSchemaPath" ;

        try (InputStream input = BidRequestHandler.class.getClassLoader().getResourceAsStream("config.properties")) {

            Properties prop = new Properties();
            if (input == null) {
                logger.error("Sorry, unable to find config.properties");
                return;
            }

            //load a properties file from class path, inside static method
            prop.load(input);
            //get the property value and print it out
            metricsIntervalMs = new Integer(prop.getProperty("aik.inference.server.metrics.interval.ms"));


        } catch (IOException ex) {
            ex.printStackTrace();
        }

        this.loadConfig() ;
        ScheduledExecutorService executorService = Executors
                .newSingleThreadScheduledExecutor();
        // schedule printing of the metrics
        executorService.scheduleAtFixedRate(() -> logger.warn("current execution average (ms): " + totalStats.getAverage()), 0, metricsIntervalMs, TimeUnit.MILLISECONDS);
    }


    private void loadConfig() {
        //load inference model using XGB library
        logger.info("Getting URI of the filtering model");
        String filteringModelUri = getValueFromSsmParameter(filteringModelSsmParameterName) ;
        String transformationModelUri = getValueFromSsmParameter(transformationModelSsmParameterName) ;
        String transformationModelSchemaUri = getValueFromSsmParameter(transformationModelSchemaSsmParameterName) ;
        logger.info("Downloading bidding filter model "+ filteringModelUri);
        loadModel(transformationModelUri,transformationModelSchemaUri,filteringModelUri);
        logger.info("Loading in memory transformer model");
    }


    private void loadModel(String s3URITransformationModel,
                           String s3URITransformationModelSchema,
                           String s3URIFilteringModel ) {

        logger.info("Downloading transformations model for feature processing from " + s3URITransformationModel);
        String modelLocation = Downloader.getTransformerModel(s3URITransformationModel);
        logger.info("Downloading schema for feature processing");
        String schemaLocation = Downloader.getTransformerSchema(s3URITransformationModelSchema);

        // load model for feature transformation
        logger.info("Loading in memory transformer model");
        Transform$.MODULE$.loadModel(modelLocation);
        logger.info("Loading in memory schema model");
        Transform$.MODULE$.loadSchema(schemaLocation);

        //load inference model using XGB library
        logger.info("Downloading bidding filter model");
        String modelBiddingFilterLocation = Downloader.getFilteringModel(s3URIFilteringModel);
        logger.info("Loading in memory transformer model");

        filter.loadModel(modelBiddingFilterLocation);
    }


    /**
     * return a string value  from an SSM parameter
     * @param ssmParameterName the name of SSM parameter
     * @return the value stored
     */
    private String getValueFromSsmParameter(String ssmParameterName) {
        logger.traceEntry();
        SsmClient ssmClient = SsmClient.builder()
                .build();
        String valueFromSsmParameter = "";
        try {
            logger.info("getting parameter for parameter name " + ssmParameterName);
            GetParameterRequest parameterRequest = GetParameterRequest.builder()
                    .name(ssmParameterName)
                    .build();

            GetParameterResponse parameterResponse = ssmClient.getParameter(parameterRequest);
            valueFromSsmParameter = parameterResponse.parameter().value();
            logger.info("successfully retrieved parameter " + valueFromSsmParameter);

        } catch (SsmException e) {
            logger.error("error while reading SSM parameter");
            logger.catching(e);
        } finally {
            ssmClient.close();
        }
        return logger.traceExit(valueFromSsmParameter);
    }





    public BidResponse filter(BidRequest request) throws org.apache.thrift.TException {
        logger.info("starting filtering a bid request");

        Instant start = Instant.now();
        BidResponse response = new BidResponse();

        try {
            List<Double> transformedFeature = Transform$.MODULE$.transform(request);
            logger.info("nb featured : " + transformedFeature.size());

            // Compute likelihood to bid for each TP
            double likelihood = filter.filter(transformedFeature);
            logger.trace("advertiser ID " + request.advertiserId + " likelihood to bid " + likelihood);

            response.likelihoodToBid = likelihood;
            Instant stop = Instant.now();

            Duration totalDuration = Duration.between(start, stop);
            double totalExecutionTime = totalDuration.getNano() / 1000000.d;
            //logger.warn("par Thread " + Thread.currentThread().getId() + "execution time " +  totalExecutionTime + " micro " +  totalDuration.getNano()/1000 );
            totalStats.accept(totalExecutionTime);
            statsd.incrementCounter("filtering_count");
            statsd.recordExecutionTime("filtering_latency", totalDuration.getNano() / 1000);
        }
        catch (Exception e ){
            logger.warn("An exception was caught " + e) ;
            e.printStackTrace();
        }
        return response;
    }
}

