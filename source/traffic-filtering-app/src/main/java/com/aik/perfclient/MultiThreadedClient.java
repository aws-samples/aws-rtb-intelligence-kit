// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0


package com.aik.perfclient;


import com.aik.filterapi.BidRequest;
import com.aik.filterapi.BidRequestFilter;
import com.aik.filterapi.BidResponse;
import com.google.common.math.Quantiles;
import com.timgroup.statsd.NonBlockingStatsDClient;
import com.timgroup.statsd.StatsDClient;
import is.tagomor.woothee.Classifier;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.apache.thrift.TException;
import org.apache.thrift.protocol.TBinaryProtocol;
import org.apache.thrift.protocol.TProtocol;
import org.apache.thrift.transport.TSocket;
import org.apache.thrift.transport.TTransport;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;
import software.amazon.awssdk.services.ssm.SsmClient;
import software.amazon.awssdk.services.ssm.model.GetParameterRequest;
import software.amazon.awssdk.services.ssm.model.GetParameterResponse;
import software.amazon.awssdk.services.ssm.model.SsmException;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.nio.file.Paths;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.IntStream;


public class MultiThreadedClient {
    private static final Logger logger = LogManager.getLogger(MultiThreadedClient.class.getName());
    private static final StatsDClient statsd = new NonBlockingStatsDClient("adserver_client", "localhost", 8125);


    public static void main(String[] args) {
        logger.warn("Starting client");
        logger.warn("Sleep 30 s");

        try {
            TimeUnit.SECONDS.sleep(30);
        } catch (InterruptedException e) {
            logger.error("Failed while waiting");
            logger.catching(e);
        }
        logger.info("Start downloading test data");
        try {
            int nbThread = 1;
            int nbTest = 100000;
            String inputRequestUri = "" ;
            if (args.length > 0) {
                nbThread = Integer.parseInt(args[1]);
                nbTest = Integer.parseInt(args[2]);
                inputRequestUri = getValueFromSsmParameter("/aik/inference_data");
            }

            logger.warn("nbThread " + nbThread ) ;
            logger.warn("nbTest " + nbTest ) ;

            //  download file from s3
            AbstractMap.SimpleEntry<String,String> s3URIParsed  = MultiThreadedClient.parseS3Uri(inputRequestUri);
            MultiThreadedClient.downloadTestFile(s3URIParsed.getKey(),s3URIParsed.getValue(),"./.tmp/test.json") ;
            ArrayList<BidRequest> dataset =  MultiThreadedClient.loadData("./.tmp/test.json") ;

            perform(nbThread,nbTest,dataset);


            logger.info("Ending client");
        } catch (TException x) {
            logger.error("Exception while opening TCP socket");
            logger.catching(x);
        }
    }

    private static FilteringResult executeInPromise(BidRequestFilter.Client client, BidRequest bidRequest) {
        FilteringResult filteringResult = null;
        try {
            filteringResult = MultiThreadedClient.performOne(client, bidRequest);
        } catch (TException e) {
            e.printStackTrace();
        }

        return filteringResult;
    }

    private static void perform(int nbThread,int nbTest, ArrayList<BidRequest> bidRequests) throws TException {
        ExecutorService executorService = Executors.newFixedThreadPool(nbThread);
        List<Callable<List<FilteringResult>>> callables = new ArrayList<>();
        logger.warn("starting load test");
        Instant start = Instant.now();

        for (int curentThreadIdx = 0; curentThreadIdx < nbThread; curentThreadIdx++) {
            final int threadId = curentThreadIdx ;
            Callable<List<FilteringResult>> callable = () -> {
                TTransport transport;

                transport = new TSocket("localhost", 9090);
                transport.open();
                TProtocol protocol = new TBinaryProtocol(transport);
                BidRequestFilter.Client client = new BidRequestFilter.Client(protocol);
                logger.info(" nbTest " + nbTest + " nb Thread " + nbThread + " bid request size " + bidRequests.size()) ;
                IntStream idxStream = new Random().ints(nbTest / nbThread, threadId*(nbTest / nbThread), bidRequests.size());
                List<FilteringResult> filteringResults = idxStream.mapToObj(i -> {
                    //logger.warn("par Thread " + Thread.currentThread().getId());
                    logger.trace("random idx " + i);
                    return MultiThreadedClient.executeInPromise(client, bidRequests.get(i));
                }).collect(Collectors.toList());
                transport.close();
                return filteringResults;
            };
            callables.add(callable) ;
        }
        List<Future<List<FilteringResult>>> result = null ;
        try {
            result = executorService.invokeAll(callables) ;
        } catch (InterruptedException e) {
            e.printStackTrace();
        }

         logger.warn("current Thread " + Thread.currentThread().getId());

        assert result != null;
        List<FilteringResult> dataset = result.stream().map(futureExec -> {
            List<FilteringResult> filteringResults = null;
            try {
                filteringResults = futureExec.get();
            } catch (InterruptedException | ExecutionException e) {
                e.printStackTrace();
            }
            return filteringResults;
        }).filter(Objects::nonNull).flatMap(List::stream).collect(Collectors.toList());

        logger.warn("starting load end");


        List<Double> datasetExecutionTime = dataset.stream().map(FilteringResult::getExecutionTime).collect(Collectors.toList());
        List<Double> datasetLikelihood = dataset.stream().map(FilteringResult::getLikelihood).collect(Collectors.toList());

        //AWSXRay.endSegment();
        Duration totalExecutionDuration = Duration.between(start, Instant.now());
        float totalExecutionTime = (float) totalExecutionDuration.toMillis() / 1000.f;
        logger.warn("ending load test (s)" + totalExecutionTime);
        logger.warn("observed throughput (qps)" + (float) nbTest / totalExecutionTime);
        DoubleSummaryStatistics execTimeStatistics = datasetExecutionTime.stream().collect(Collectors.summarizingDouble(Double::doubleValue));
        DoubleSummaryStatistics likelihoodStatistics = datasetLikelihood.stream().collect(Collectors.summarizingDouble(Double::doubleValue));

        double p99ExecutionTime = Quantiles.percentiles().index(99).compute(datasetExecutionTime);
        double p95ExecutionTime = Quantiles.percentiles().index(95).compute(datasetExecutionTime);
        logger.warn("------------ execution time -------------");
        logger.warn("Mean execution time (ms) = " + execTimeStatistics.getAverage());
        logger.warn("Max execution time (ms) = " + execTimeStatistics.getMax());
        logger.warn("Min execution time (ms) = " + execTimeStatistics.getMin());
        logger.warn("p99 execution time (ms) = " + p99ExecutionTime);
        logger.warn("p95 execution time (ms) = " + p95ExecutionTime);
        logger.warn("------------ likelihood -------------");
        logger.warn("Mean likelihood time (ms) = " + likelihoodStatistics.getAverage());
        logger.warn("Max likelihood time (ms) = " + likelihoodStatistics.getMax());
        logger.warn("Min likelihood time (ms) = " + likelihoodStatistics.getMin());

        executorService.shutdown();
    }

    private static FilteringResult performOne(BidRequestFilter.Client client, BidRequest bidRequest) throws TException {
        logger.info("start bid request filtering");
        Duration filteringExecutionTime = null;
        double likelihoodToBid = 0.0 ;

        try {
            logger.info("filter bid request");
            logger.info("bid request " + bidRequest) ;
            Instant start = Instant.now();
            BidResponse response = client.filter(bidRequest);
            filteringExecutionTime = Duration.between(start, Instant.now());
            likelihoodToBid = response.likelihoodToBid ;
            logger.info("bid request successfully filtered");
            statsd.recordGaugeValue("adserver_latency_h", ((float) filteringExecutionTime.getNano()) / 1000000.f);
            statsd.recordExecutionTime("adserver_latency_ms", filteringExecutionTime.getNano() / 1000);
            statsd.recordGaugeValue("likelihood_to_bid", response.likelihoodToBid);
            logger.info("stats recorded successfully");
            logger.info("Advertiser Index " + bidRequest.advertiserId + " likelihood to bid " + response.likelihoodToBid);

        } catch (org.apache.thrift.TException io) {
            logger.error("Exception while filtering bid request");
            logger.catching(io);
        }

        logger.info("end bid request filtering");
        assert filteringExecutionTime != null;
        return new FilteringResult ((double) filteringExecutionTime.getNano() / 1000000.f,likelihoodToBid);
    }

    public static AbstractMap.SimpleEntry<String,String>  parseS3Uri(String s3URI) {
        logger.info("connection start");
        final String regex = "^s3://([^/]+)/(.+)$" ;

        final Pattern pattern = Pattern.compile(regex, Pattern.MULTILINE);
        final Matcher matcher = pattern.matcher(s3URI);

        AbstractMap.SimpleEntry<String,String> parsedURI = null ;

        while (matcher.find()) {
            System.out.println("Full match: " + matcher.group(0));

            parsedURI = new AbstractMap.SimpleEntry<>(matcher.group(1), matcher.group(2) );

        }

        return parsedURI ;


    }
    static private void downloadTestFile(String bucketName,String prefix, String path) {

        try (S3Client s3 = S3Client.builder().build()){
            String keyName = "";
            ListObjectsRequest listObjects = ListObjectsRequest
                    .builder()
                    .bucket(bucketName)
                    .prefix(prefix)
                    .build();

            ListObjectsResponse res = s3.listObjects(listObjects);
            List<S3Object> objects = res.contents();

            for (S3Object firstObject : objects) {
                keyName = firstObject.key();
            }
            GetObjectRequest objectRequest = GetObjectRequest
                    .builder()
                    .key(keyName)
                    .bucket(bucketName)
                    .build();

            s3.getObject(objectRequest, Paths.get(path));
        } catch (S3Exception e) {
            logger.catching(e);
            System.exit(1);
        }
    }


    static private ArrayList<BidRequest> loadData(String path) {

        Object obj ;
        logger.warn("start loading data in memory");
        ArrayList<BidRequest> bidRequestList = new ArrayList<>();
        int maxObject = 20000;
        int nbObject = 0;
        try {
            try (BufferedReader br = new BufferedReader(new FileReader(path))) { //creates a buffering character input stream
                String line;
                while ((line = br.readLine()) != null && nbObject <= maxObject) {
                    obj = new JSONParser().parse(line);
                    BidRequest bidRequest = new BidRequest();

                    JSONObject rawObj = (JSONObject) obj;
                    bidRequest.bidId = rawObj.get("BidID").toString();
                    bidRequest.dayOfWeek = Integer.parseInt(rawObj.get("dow").toString());
                    bidRequest.hour = rawObj.get("hour").toString();
                    if (rawObj.get("AdvertiserID") == null) {
                        bidRequest.advertiserId = "";
                    } else {
                        bidRequest.advertiserId = rawObj.get("AdvertiserID").toString();
                    }
                    bidRequest.domainId = rawObj.get("Domain").toString();
                    bidRequest.regionId = rawObj.get("RegionID").toString();
                    bidRequest.cityId = rawObj.get("CityID").toString();
                    if (rawObj.get("BiddingPrice") == null) {
                        bidRequest.biddingPrice = 0;
                    } else {
                        bidRequest.biddingPrice = Long.parseLong(rawObj.get("BiddingPrice").toString());
                    }
                    if (rawObj.get("PayingPrice") == null) {
                        bidRequest.payingPrice = 0;
                    } else {
                        bidRequest.payingPrice = Long.parseLong(rawObj.get("PayingPrice").toString());
                    }
                    if (rawObj.get("UserAgent") == null) {
                        bidRequest.deviceTypeId = 5;
                    } else {
                        bidRequest.deviceTypeId = MultiThreadedClient
                                .getDeviceTypeId(rawObj.get("UserAgent").toString());
                    }

                    bidRequestList.add(bidRequest);
                    nbObject = nbObject + 1;
                }
            }
        } catch (IOException | ParseException e) {
            e.printStackTrace();
        }
        logger.warn("end loading data in memory " + bidRequestList.size());
        return bidRequestList;
    }

    /**
     * return a string value  from an SSM parameter
     * @param ssmParameterName the name of SSM parameter
     * @return the value stored
     */
    private static String getValueFromSsmParameter(String ssmParameterName) {
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

    static public int getDeviceTypeId(String userAgent) {
        Map<String, String> r = Classifier.parse(userAgent);
        String category = r.get("category");
        int deviceTypeId;
        switch (category) {
            case "smartphone":
                deviceTypeId = 0;
                break;
            case "mobilephone":
                deviceTypeId = 1;
                break;
            case "appliance":
                deviceTypeId = 2;
                break;
            case "pc":
                deviceTypeId = 3;
                break;
            case "crawler":
                deviceTypeId = 4;
                break;
            default:
                deviceTypeId = 5;
                break;
        }
        return deviceTypeId;
    }
}
