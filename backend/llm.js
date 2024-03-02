"use strict";
const AWS = require("aws-sdk"); // eslint-disable-line import/no-extraneous-dependencies
const helpers = require("./helpers");
// const dynamoDb = new AWS.DynamoDB.DocumentClient();
// const jwt = require("jsonwebtoken");

const OpenAI = require("openai");

const openai = new OpenAI({
  organization: "org-n4LAwNQs9NKixxSOXsLLvaPf",
  apiKey: process.env.OPENAI_KEY,
});

module.exports.create = async (event, context, callback) => {
  if (typeof event === "string") event = JSON.parse(event);
  const data = JSON.parse(event.body);

  const chatCompletion = await openai.chat.completions.create({
    messages: data.messageHistory,
    model: "gpt-3.5-turbo",
  });
  const responseText = chatCompletion.choices[0].message.content
  console.log(responseText);

  callback(
    null,
    helpers.validCallbackObject({
      responseText
      // token: jwt.sign({ PK: ddbUser.PK }, process.env.JWT_SECRET),
    })
  );
};
