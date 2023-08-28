const uuid = require("uuid");
const AWS = require("aws-sdk");
const jwt = require("jsonwebtoken");
const helpers = require("./helpers");
const { getRounds } = require("bcryptjs");
const { validCallbackObject } = require("./helpers");
const apig = new AWS.ApiGatewayManagementApi({
  //Offline check for websocket issue with serverless offline
  //https://github.com/dherault/serverless-offline/issues/924
  endpoint: process.env.IS_OFFLINE
    ? `http://localhost:3001`
    : process.env.APIG_ENDPOINT,
});
const dynamodb = new AWS.DynamoDB.DocumentClient();

const DB = process.env.DB;

exports.handler = async function (event, context) {
  const {
    body,
    requestContext: { connectionId, routeKey, identity },
  } = event;
  const timestamp = new Date().getTime();
  let userPK = null,
    bodyAsJSON = null,
    PK = null,
    SK = null,
    senderId = null;
  if (body) {
    bodyAsJSON = JSON.parse(body);
    // userPK = jwt.decode(bodyAsJSON.token, process.env.JWT_SECRET).PK;
    senderId = connectionId;
  }
  const dealDamage = (connectionId, damage, chatRoomId) => {
    const rowParams = {
      TableName: process.env.DB,
      Key: {
        PK: chatRoomId,
        SK: "CONNECTION#" + connectionId,
      },
      UpdateExpression: "SET health = health - :val",
      ExpressionAttributeValues: {
        ":val": damage,
      },
    };
    dynamodb.update(rowParams, (e, data) => {
      if (e) {
        console.error(
          "Unable to update item. Error JSON:",
          JSON.stringify(e, null, 2)
        );
      }
    });
    // Check for 0 health (death)
    dynamodb.get(rowParams, (err, data) => {
      if (err) {
        console.error("Couldn't get user item after deal damage");
      } else {
        if (data.Item?.health <= 0) {
          // Do death mechanics
          // 1. drop items of player on ground --- TBD
          
          // 2. reset player who died's position
          //    a. post to connections.
          
          // 3. reset players health to full
          const resetHealthParams = {
            TableName: process.env.DB,
            Key: {
              PK: chatRoomId,
              SK: "CONNECTION#" + connectionId,
            },
            UpdateExpression: "SET health = 30",
          };
          dynamodb.update(resetHealthParams, (e, data) => {
            if (e) {
              console.error(
                "Unable to update item. Error JSON:",
                JSON.stringify(e, null, 2)
              );
            }
          });
        }
      }
    });
  };

  switch (routeKey) {
    case "$connect":
      // console.log("connected", connectionId);
      break;

    case "$disconnect":
      // console.log("disconnected", connectionId);
      break;

    // const samplePayload = {
    //   "action": "connectToChatRoom",
    //   "chatRoomId": "CHATROOM#123"
    //   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJQSyI6IlVTRVIjZmNjMmNjNTAtZGNiOC0xMWViLWJjOWItZTFkNmIwNmI3ZGIzIiwiaWF0IjoxNjI1NjY0MjEwfQ.CI8C_oZpDfIETQOHktt4HkIlBEhn_2jy7dLwd0b0zPM"
    // }
    case "connectToChatRoom":
      SK = "CONNECTION#" + connectionId;
      PK = bodyAsJSON.chatRoomId; //TODO: Auth check
      await dynamodb
        .put({
          TableName: DB,
          Item: {
            PK,
            SK,
            created: timestamp,
            ttl: Math.floor(new Date().getTime() / 1000) + 360, // 6 mins from now?
            health: 30,
          },
        })
        .promise();
      //Get all connectionIDs associated with chatroom to send back to user
      const usersParams = {
        TableName: process.env.DB,
        KeyConditionExpression: "PK = :pk and begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": bodyAsJSON.chatRoomId,
          ":sk": "CONNECTION#",
        },
      };
      const getConnections = await dynamodb.query(usersParams).promise();
      try {
        await apig
          .postToConnection({
            ConnectionId: connectionId,
            Data: JSON.stringify({
              yourConnectionId: senderId,
              connections: getConnections.Items,
            }),
          })
          .promise();
      } catch (e) {
        console.log(
          "Could not send chatroom connections to user",
          connectionId
        );
      }
      break;

    // const samplePayload = {
    //   "message": "yo whats up?",
    //   "action": "sendMessagePublic",
    //   "chatRoomId": "CHATROOM#1234567",
    //   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJQSyI6IlVTRVIjZmNjMmNjNTAtZGNiOC0xMWViLWJjOWItZTFkNmIwNmI3ZGIzIiwiaWF0IjoxNjI1NjY0MjEwfQ.CI8C_oZpDfIETQOHktt4HkIlBEhn_2jy7dLwd0b0zPM"
    // }
    case "sendMessagePublic":
      try {
        //Get all connectionIDs associated with chatroom
        const usersParams = {
          TableName: process.env.DB,
          KeyConditionExpression: "PK = :pk and begins_with(SK, :sk)",
          ExpressionAttributeValues: {
            ":pk": bodyAsJSON.chatRoomId,
            ":sk": "CONNECTION#",
          },
        };
        const getConnections = await dynamodb.query(usersParams).promise();
        //Send message to socket connections
        for (const connection of getConnections.Items) {
          const connectionId = connection.SK.split("#")[1];
          try {
            await apig
              .postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({
                  message: bodyAsJSON.message,
                  senderId,
                  chatMessage: true,
                  timestamp: Date.now(),
                }),
              })
              .promise();
          } catch (e) {
            console.log(
              "couldn't send websocket message to " + connectionId,
              e
            );
          }
        }
      } catch (e) {
        console.error(e);
      }
      break;

    case "sendUpdate": //TODO: rename to send update
      try {
        //Send message to socket connections
        //TODO VERIFY CAN ATTACK (SECURITY)
        const attackingPlayer = bodyAsJSON.message.attackingPlayer;
        let damage = 0;
        if (attackingPlayer) {
          damage = Math.floor(Math.random() * 3) + 1;
          bodyAsJSON.message.damageGiven = {
            receivingPlayer: attackingPlayer,
            damage,
          };
          dealDamage(attackingPlayer, damage, bodyAsJSON.chatRoomId);
        }
        for (const otherConnectionId of bodyAsJSON.connections) {
          bodyAsJSON.message.connectionId = connectionId;
          bodyAsJSON.message.userId = senderId;
          try {
            await apig
              .postToConnection({
                ConnectionId: otherConnectionId,
                Data: JSON.stringify(bodyAsJSON.message),
              })
              .promise();
          } catch (e) {
            // console.log("couldn't send websocket message to "+ otherConnectionId, e);
          }
        }
      } catch (e) {
        console.error(e);
      }
      break;
  }

  // Return a 200 status to tell API Gateway the message was processed
  // successfully.
  // Otherwise, API Gateway will return a 500 to the client.
  return { statusCode: 200 };
};

// /openChatRoom - get messages for chatroom
// header: token
// body: {
//       chatRoomId: xxx
// }
module.exports.openChatRoom = async (event, context, callback) => {
  if (typeof event === "string") event = JSON.parse(event);
  const data = JSON.parse(event.body);

  const decoded = jwt.decode(
    event.headers.Authorization,
    process.env.JWT_SECRET
  );
  try {
    const params = {
      TableName: process.env.DB,
      KeyConditionExpression: "PK = :pk and begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": data.chatRoomId, ":sk": "MESSAGE#" },
    };
    const getMessages = await dynamodb.query(params).promise();
    callback(
      null,
      helpers.validCallbackObject({ messages: getMessages.Items })
    );
  } catch (e) {
    console.error(e);
  }
};

// /getChatRooms - get chat rooms for user
// header: token
module.exports.getChatRooms = async (event, context, callback) => {
  if (typeof event === "string") event = JSON.parse(event);
  const data = JSON.parse(event.body);

  const decoded = jwt.decode(
    event.headers.Authorization,
    process.env.JWT_SECRET
  );
  try {
    const getChatRoomsParams = {
      TableName: process.env.DB,
      KeyConditionExpression: "PK = :pk and begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": decoded.PK, ":sk": "CHATROOM#" },
    };
    let chatRooms = await dynamodb.query(getChatRoomsParams).promise();
    for (let chatRoom of chatRooms.Items) {
      const getChatRoomUsersParams = {
        TableName: process.env.DB,
        KeyConditionExpression: "PK = :pk and begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": chatRoom.SK, ":sk": "USER#" },
      };
      const chatRoomUsers = await dynamodb
        .query(getChatRoomUsersParams)
        .promise();
      // Avoid sending back user guid
      chatRoomUsers.Items.forEach((x) => delete x.SK);
      chatRoom.users = chatRoomUsers.Items;
    }

    // Avoid sending back user guid
    chatRooms.Items.forEach((x) => delete x.PK);
    callback(null, helpers.validCallbackObject({ rooms: chatRooms.Items }));
  } catch (e) {
    console.error(e);
  }
};

// /createChatRoom - creates rows in db necessary for chatroom
// header: token
// body: {
//   name: "chatroomName"
// }
module.exports.createChatRoom = async (event, context, callback) => {
  if (typeof event === "string") event = JSON.parse(event);
  const data = JSON.parse(event.body);

  const decoded = jwt.decode(
    event.headers.Authorization,
    process.env.JWT_SECRET
  );

  try {
    const chatRoomId = "CHATROOM#" + uuid.v1();
    const timestamp = new Date().getTime();

    const getHandleParams = {
      TableName: process.env.DB,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": decoded.PK },
    };
    const getHandle = await dynamodb.query(getHandleParams).promise();
    const handle = getHandle.Items[0].handle;
    const roomParams = {
      TableName: process.env.DB,
      Item: {
        PK: chatRoomId,
        SK: decoded.PK,
        handle: handle,
        name: data.name,
        modified: timestamp,
      },
    };
    await dynamodb.put(roomParams).promise();

    const userParams = {
      TableName: process.env.DB,
      Item: {
        PK: decoded.PK,
        SK: chatRoomId,
        handle: handle,
        created: timestamp,
      },
    };
    await dynamodb.put(userParams).promise();

    callback(null, helpers.validCallbackObject({ chatRoomId }));
  } catch (e) {
    console.error(e);
    callback(null, helpers.invalidCallbackObject("Failed to create chatroom"));
  }
};
