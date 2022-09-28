// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

package com.aik.perfclient;

public class FilteringResult {
    private double executionTime  ;
    private double likelihood;

    public FilteringResult(double executionTime, double likelihood) {
        this.executionTime = executionTime;
        this.likelihood = likelihood;
    }

    public double getExecutionTime() {
        return executionTime;
    }

    public double getLikelihood() {
        return likelihood;
    }
}
