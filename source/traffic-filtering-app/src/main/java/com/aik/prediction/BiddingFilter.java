// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

package com.aik.prediction;

import ml.dmlc.xgboost4j.java.Booster;
import ml.dmlc.xgboost4j.java.DMatrix;
import ml.dmlc.xgboost4j.java.XGBoost;
import ml.dmlc.xgboost4j.java.XGBoostError;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.time.Duration;
import java.time.Instant;
import java.util.*;


public class BiddingFilter {
    private static final Logger logger = LogManager.getLogger(BiddingFilter.class.getName());
    private static Booster booster;

    final private static DoubleSummaryStatistics mainStats = new DoubleSummaryStatistics();


    public void loadModel(String modelLocation) {
        logger.info("load model in memory");
        long startTime = System.currentTimeMillis();
        try {
            BiddingFilter.booster = XGBoost.loadModel(modelLocation);
        } catch (XGBoostError e) {
            logger.error("model location : ["+modelLocation+"]");
            logger.error("error while loading filtering model " + modelLocation);
            logger.catching(e);
        }
        long endTime = System.currentTimeMillis() - startTime;
        logger.info("--- load model in: " + endTime + "ms");
    }

    public Double filter( List<Double> bidRequest) {
        Instant mainStart = Instant.now() ;
        double likelihoodToBid = -1 ;
            float[] testInput = new float[bidRequest.size()];
            float[][] predicts ;
            for (int i = 0, total = bidRequest.size(); i < total; i++) {
                testInput[i] = bidRequest.get(i).floatValue();
            }
            logger.info("filtering input " + Arrays.toString(testInput)) ;
            try {
                //One row, X columns
                DMatrix testMatOneRow = new DMatrix(testInput, 1, testInput.length, Float.NaN);
                predicts = BiddingFilter.booster.predict(testMatOneRow);

                if (predicts.length > 0) {
                    if (predicts[0].length > 0) {
                        likelihoodToBid = predicts[0][0];
                    }
                }
            } catch (XGBoostError e) {
                logger.catching(e);
            }

        logger.info("likelihood to bid " + likelihoodToBid) ;
        Instant mainStop = Instant.now() ;
        Duration mainDuration = Duration.between(mainStart,mainStop) ;
        double mainTime = mainDuration.getNano()/1000000.d;
        mainStats.accept(mainTime);
        return likelihoodToBid;
    }


}