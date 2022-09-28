// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

package com.aik.prediction;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;


import java.io.File;
import java.util.AbstractMap;
import java.util.Random;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class Downloader {

    private static final Logger logger = LogManager.getLogger(Downloader.class.getName());
    final private static  String transformerFileNamePrefix = "transformer" ;
    final private static  String schemaFileNamePrefix = "schema" ;
    final private static  String filteringFileNamePrefix = "filtering" ;
    final private static String suffix = "model" ;
    final private static String tempDirectory = ".tmp" ;

    final private static Random generator = new Random() ;
    final private static int MaxRandomNumber = 100000000 ;

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

    public static File generateFileName(String prefix,String extension) {
        File downloadedFile  ;
        int randomness = generator.nextInt(MaxRandomNumber);
        downloadedFile = new File (tempDirectory+"/"+prefix+"-" + randomness +"-" + Downloader.suffix+extension)  ;
        return downloadedFile ;
    }

    public static String getTransformerModel(String s3URIModelTransformer) {

        AbstractMap.SimpleEntry<String,String> s3URIParsed = Downloader.parseS3Uri(s3URIModelTransformer) ;
        File downloadedFile = Downloader.generateFileName(Downloader.transformerFileNamePrefix,".zip") ;

        String keyName = s3URIParsed.getValue() ;
        String bucketName = s3URIParsed.getKey() ;

        logger.info("key name for transformer model " + keyName ) ;
        logger.info("bucket name for transformer model" + bucketName) ;
        S3Client s3 = S3Client.builder()
                .build();

        GetObjectRequest objectRequest = GetObjectRequest
                .builder()
                .key(keyName)
                .bucket(bucketName)
                .build();

        s3.getObject(objectRequest, downloadedFile.toPath());
        s3.close() ;
        logger.info("Model downloaded");

        return downloadedFile.getAbsolutePath();
    }

    public static String getTransformerSchema(String s3URISchema) {
        logger.info("connection start");

        AbstractMap.SimpleEntry<String,String> s3URIParsed = Downloader.parseS3Uri(s3URISchema) ;
        File downloadedFile = Downloader.generateFileName(Downloader.schemaFileNamePrefix,".json") ;
        String keyName = s3URIParsed.getValue() ;
        String bucketName = s3URIParsed.getKey() ;



        logger.info("key name for transformer model " + keyName ) ;
        logger.info("bucket name for transformer model" + bucketName) ;
        S3Client s3 = S3Client.builder()
                .build();

        GetObjectRequest objectRequest = GetObjectRequest
                .builder()
                .key(keyName)
                .bucket(bucketName)
                .build();

        s3.getObject(objectRequest, downloadedFile.toPath());
        s3.close() ;
        logger.info("Model downloaded");

        return downloadedFile.getAbsolutePath();
    }

    public static String getFilteringModel(String s3URIFilteringModel) {
        AbstractMap.SimpleEntry<String,String> s3URIParsed = Downloader.parseS3Uri(s3URIFilteringModel) ;
        File downloadedFile = Downloader.generateFileName(Downloader.filteringFileNamePrefix,".bin") ;


        String keyName = s3URIParsed.getValue() ;
        String bucketName = s3URIParsed.getKey() ;

        logger.info("key name for transformer model " + keyName ) ;
        logger.info("bucket name for transformer model" + bucketName) ;
        S3Client s3 = S3Client.builder()
                .build();
        GetObjectRequest objectRequest = GetObjectRequest
                .builder()
                .key(keyName)
                .bucket(bucketName)
                .build();

        s3.getObject(objectRequest, downloadedFile.toPath());
        s3.close() ;
        logger.info("Model  found");
        logger.info(downloadedFile.getAbsolutePath());

        return downloadedFile.getAbsolutePath();
    }

}