// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

package com.aik.prediction;

import com.aik.filterapi.BidRequestFilter;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.apache.thrift.server.TServer;
import org.apache.thrift.server.TThreadPoolServer;
import org.apache.thrift.transport.TServerSocket;
import org.apache.thrift.transport.TServerTransport;


public class InferenceServer {

    private static final Logger logger = LogManager.getLogger(InferenceServer.class.getName());

    public static BidRequestHandler handler;

    public static BidRequestFilter.Processor<BidRequestFilter.Iface> processor;

    public static void main(String[] args) {
        try {

            logger.info("Downloading transformer model");

            handler = new BidRequestHandler();
            handler.init();
            processor = new BidRequestFilter.Processor<>(handler);

            Runnable simple = () -> simple(processor);

            new Thread(simple).start();
        } catch (Exception x) {
            x.printStackTrace();
        }
    }

    public static void simple(BidRequestFilter.Processor<BidRequestFilter.Iface> processor) {
        try {
            TServerTransport serverTransport = new TServerSocket(9090);

            // Use this for a multithreaded server
            TThreadPoolServer.Args pool = new TThreadPoolServer.Args(serverTransport).processor(processor);
            pool.minWorkerThreads(8);
            pool.minWorkerThreads(2);
            TServer server = new TThreadPoolServer(pool);

            logger.info("Starting the simple server...");
            server.serve();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
