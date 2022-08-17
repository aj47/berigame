import { Vector3 } from 'three';
import { auth } from './Auth'

let url = "https://rmwrulu837.execute-api.ap-southeast-2.amazonaws.com/dev/"
let wsUrl = "wss://ahftzn2xw8.execute-api.ap-southeast-2.amazonaws.com/dev/"
// if (process.env.NODE_ENV === 'development')  {
//   url = "http://localhost:3000/dev/";
//   wsUrl = "ws://localhost:3001";
// }
const connectedUsers: any = {};
let allConnections: any = [];
let clientConnectionId = null;
// export const webSocketSaveConnection = async () => {
//   try {
//     const token = await auth.getToken();
//     if (token) {
//       const payload = {
//         token,
//         action: "saveConnection",
//       }
//       webSocketConnection?.send(JSON.stringify(payload));
//     }
//   } catch (e) {
//     console.error("webSocketSaveConnection Error:", e);
//   }
// }

interface PositionMessage {
  // userId: string | number;
  position: string | number;
  rotation: string | number;
  restPosition: string | Vector3;
}

export const webSocketSendPosition = async (message: PositionMessage, ws: any, allConnections: any[]) => {
  try {
    const payload = {
      message,
      connections: allConnections,
      chatRoomId: "CHATROOM#913a9780-ff43-11eb-aa45-277d189232f4", //The one chatroom for MVP
      action: "sendPosition",
    }
    ws?.send(JSON.stringify(payload));
  } catch (e) {
    console.error("webSocketSendMessage Error:", e);
    setTimeout(() => {
      webSocketSendPosition(message, ws, allConnections);
    }, 500);
  }
}

export const webSocketSendMessage = async (message: string, ws: any) => {
  try {
    const payload = {
      message,
      chatRoomId: "CHATROOM#913a9780-ff43-11eb-aa45-277d189232f4", //The one chatroom for MVP
      action: "sendMessagePublic",
    }
    ws?.send(JSON.stringify(payload));
    return payload;
  } catch (e) {
    console.error("webSocketSendMessage Error:", e);
  }
}

export const connectToChatRoom = async (chatRoomId: string = "", ws: any) => {
  try {
    const payload = {
      chatRoomId: "CHATROOM#913a9780-ff43-11eb-aa45-277d189232f4", //The one chatroom for MVP
      action: "connectToChatRoom",
    }
    ws?.send(JSON.stringify(payload));
  } catch (e) {
    // console.log("webSocketSaveConnection Error:", e);
    setTimeout(() => {
      connectToChatRoom(chatRoomId, ws);
    }, 500);
  }
}

const _webSocketError = (e: Event) => {
  console.error("Websocket error:", e);
}

const _webSocketClose = (e: Event) => {
  console.log("Websocket close:", e);
}

const updateConnections = (connections: any) => {
  const tempAllConnections = [];
  for (const item of connections) {
    tempAllConnections.push(item.SK.split("#")[1]);
  }
  allConnections = tempAllConnections;
}

const updateUserPosition = (newData: any) => {
  newData.selfDestroyTime = (new Date().getTime()) + 5000;
  connectedUsers[newData.userId] = newData;
  // setUserPositions(connectedUsers);
  if (allConnections.indexOf(newData.connectionId) === -1)
    allConnections.push(newData.connectionId);
}

export const deleteUserPosition = (userId: string) => {
  delete connectedUsers[userId];
}

export const getUserPositions = () => {
  return connectedUsers;
}

export const getClientConnectionId = () => {
  return clientConnectionId;
}
