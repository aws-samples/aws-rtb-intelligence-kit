// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

package com.aik.prediction


import com.aik.filterapi._
import com.github.plokhotnyuk.jsoniter_scala.core._
import com.github.plokhotnyuk.jsoniter_scala.macros._
import ml.combust.bundle.BundleFile
import ml.combust.mleap.core.types._
import ml.combust.mleap.runtime.MleapSupport._
import ml.combust.mleap.runtime.frame.{DefaultLeapFrame, Row}
import resource.managed

import scala.collection.JavaConverters._
import scala.collection.immutable.ListMap
import scala.io.Source
//https://github.com/combust/mleap/blob/master/mleap-spark-base/src/main/scala/org/apache/spark/sql/mleap/TypeConverters.scala\n


object Transform {

  var mleapPipeline: ml.combust.mleap.runtime.frame.Transformer = null
  var schema: ml.combust.mleap.core.types.StructType = null

  def loadModel(location: String): Unit = {
    println(s"starting loading from location $location")
    // TO DO: test loading artifact from an unzipped folder
    val bundle = (for (bundleFile <- managed(BundleFile(s"jar:file:$location"))) yield {
      bundleFile.loadMleapBundle().get
    }).opt.get
    mleapPipeline = bundle.root
    println(mleapPipeline.getClass)
  }

  def loadSchema(location: String): Unit = {
    println(s"starting loading from location $location")
    val schemaFile = Source.fromFile(location)
    val schemaFileContents = schemaFile.getLines.mkString
    schemaFile.close()
    implicit val codec: JsonValueCodec[ListMap[String, String]] = JsonCodecMaker.make[ListMap[String, String]](CodecMakerConfig)
    val schemaFieldMap = readFromArray(schemaFileContents.getBytes("UTF-8"))
    //Reconstruct MLeap Schema from JSON Map
    schema = StructType(
      schemaFieldMap.toList.map {
        case (f, "DoubleType") => StructField(f, ScalarType.Double)
        case (f, "IntegerType") => StructField(f, ScalarType.Int)
        case (f, "LongType") => StructField(f, ScalarType(BasicType.Long))
        case (f, "StringType") => StructField(f, ScalarType.String)
        case (f, "ArrayType(IntegerType,true)") => StructField(f, ListType.Int)
      }
    ).get
    println(schema)
  }

  def transform(request: BidRequest): java.util.List[java.lang.Double] = {
    val rowRequest = Seq(Row(
      request.bidId,
      request.dayOfWeek,
      request.hour,
      request.regionId,
      request.cityId,
      request.domainId,
      request.advertiserId,
      request.biddingPrice,
      request.payingPrice,
      request.userAgent
    ))
    val frame = DefaultLeapFrame(schema, rowRequest)
    val predictionLeapFrame = mleapPipeline.transform(frame).get
    val vectorizedLeapFrame = predictionLeapFrame.select("dow","hour","IndexAdvertiserID","IndexDomain","IndexRegionID","IndexCityID").get.dataset
    //val vectorizedData: List[java.lang.Double] = vectorizedLeapFrame.apply(0).getTensor(0).toDense.rawValuesIterator.toList
    val vectorizedData: List[java.lang.Double] = List(vectorizedLeapFrame.head(0)).map(item => new  java.lang.Double(item.toString.toDouble)) ::: List(new  java.lang.Double(request.deviceTypeId.toDouble))
    vectorizedData.asJava



  }


}