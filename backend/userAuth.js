"use strict";
const uuid = require("uuid");
const AWS = require("aws-sdk"); // eslint-disable-line import/no-extraneous-dependencies
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const helpers = require("./helpers");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

module.exports.googleAuth = async (event, context, callback) => {
  if (typeof event === "string") event = JSON.parse(event);
  const data = JSON.parse(event.body);

  try {
    // Verify the Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: data.googleToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email.toLowerCase();
    const name = payload.name;
    const picture = payload.picture;

    // Check if user already exists by Google ID
    const checkGoogleIdParams = {
      TableName: process.env.DB,
      IndexName: "GoogleIdIndex",
      KeyConditionExpression: "googleId = :gid",
      ExpressionAttributeValues: { ":gid": googleId },
    };

    let existingUser = await dynamoDb.query(checkGoogleIdParams).promise();

    if (existingUser.Count > 0) {
      // User exists, return token
      const user = existingUser.Items[0];
      callback(
        null,
        helpers.validCallbackObject({
          token: jwt.sign({ PK: user.PK, email: user.email }, process.env.JWT_SECRET),
          user: {
            PK: user.PK,
            email: user.email,
            name: user.name,
            picture: user.picture,
          },
        })
      );
    } else {
      // Create new user
      const timestamp = new Date().getTime();
      const PK = "USER#" + uuid.v1();
      const SK = "CREATED#" + timestamp;

      const params = {
        TableName: process.env.DB,
        Item: {
          PK,
          SK,
          googleId,
          email,
          name,
          picture,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      };

      await dynamoDb.put(params).promise();
      callback(
        null,
        helpers.validCallbackObject({
          token: jwt.sign({ PK, email }, process.env.JWT_SECRET),
          user: {
            PK,
            email,
            name,
            picture,
          },
        })
      );
    }
  } catch (e) {
    console.error("Google Auth Error:", e);
    callback(null, helpers.invalidCallbackObject("Invalid Google token"));
  }
};

// Legacy login function - removed in favor of Google Auth

module.exports.auth = async (event, context, callback) => {
  try {
    const token = event.headers.Authorization || event.headers.authorization;
    if (!token) {
      callback(null, helpers.invalidCallbackObject("No token provided"));
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const checkParams = {
      TableName: process.env.DB,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": decoded.PK },
    };

    const ddbData = await dynamoDb.query(checkParams).promise();
    if (ddbData.Count === 0) {
      callback(null, helpers.invalidCallbackObject("Invalid token"));
      return;
    }

    const ddbUser = ddbData.Items[0];
    callback(
      null,
      helpers.validCallbackObject({
        token: jwt.sign({ PK: ddbUser.PK, email: ddbUser.email }, process.env.JWT_SECRET),
        user: {
          PK: ddbUser.PK,
          email: ddbUser.email,
          name: ddbUser.name,
          picture: ddbUser.picture,
        },
      })
    );
  } catch (e) {
    console.error("Auth Error:", e);
    callback(null, helpers.invalidCallbackObject("Invalid token"));
  }
};
