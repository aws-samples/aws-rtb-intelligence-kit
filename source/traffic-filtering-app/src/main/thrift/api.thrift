// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0


/**
 * The available types in Thrift are:
 *
 *  bool        Boolean, one byte
 *  i8 (byte)   Signed 8-bit integer
 *  i16         Signed 16-bit integer
 *  i32         Signed 32-bit integer
 *  i64         Signed 64-bit integer
 *  double      64-bit floating point value
 *  string      String
 *  binary      Blob (byte array)
 *  map<t1,t2>  Map from one type to another
 *  list<t1>    Ordered list of one type
 *  set<t1>     Set of unique elements of one type
 *
 */



/**
 * define java packages
 */
namespace java com.aik.filterapi


/**
 * Raw data required for filtering a bid request
 */
struct BidRequest {
  1: string bidId,
  2: i32 dayOfWeek ,
  3: string hour,
  4: string regionId,
  5: string cityId,
  6: string domainId,
  7: string advertiserId,
  8: i64 biddingPrice,
  9: i64 payingPrice,
  10: string userAgent
  11: i32 deviceTypeId
}

/**
 * Raw data required for filtering a bid request
 */
struct BidResponse {
  1: double likelihoodToBid
}


/**
 * Definition of the available service
 */
service BidRequestFilter  {

  /**
   * This method asssociate for every TP in the BidRequest
   * an indicator  specifying if the bid should be proposed to the TP
   */
   BidResponse filter(1: BidRequest request)

}


