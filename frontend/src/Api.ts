import { Vector3 } from 'three';
import { auth } from './Auth'

let url = "https://rmwrulu837.execute-api.ap-southeast-2.amazonaws.com/dev/"
let wsUrl = "wss://ahftzn2xw8.execute-api.ap-southeast-2.amazonaws.com/dev/"
// if (process.env.NODE_ENV === 'development')  {
//   url = "http://localhost:3000/dev/";
//   wsUrl = "ws://localhost:3001";
// }
const connectedUsers: any = {};
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
  isWalking: boolean;
  attackingPlayer?: boolean;
}

export const webSocketSendUpdate = async (message: PositionMessage, ws: any, allConnections: any[]) => {
  try {
    const payload = {
      message,
      connections: allConnections,
      chatRoomId: "CHATROOM#913a9780-ff43-11eb-aa45-277d189232f4", //The one chatroom for MVP
      action: "sendUpdate",
    }
    ws?.send(JSON.stringify(payload));
  } catch (e) {
    console.error("webSocketSendMessage Error:", e);
    setTimeout(() => {
      webSocketSendUpdate(message, ws, allConnections);
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

export const deleteUserPosition = (userId: string) => {
  delete connectedUsers[userId];
}

export const getUserPositions = () => {
  return connectedUsers;
}

export const getClientConnectionId = () => {
  return clientConnectionId;
}
