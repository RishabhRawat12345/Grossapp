import express from "express";
import http from "http";
import { Server } from "socket.io";
import axios from "axios";
import cors from "cors";

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 5000;

const FRONTEND_URL = process.env.FRONTEND_URL;

app.use(cors({
  origin: FRONTEND_URL,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
}));

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    credentials: true
  }
});

app.use(express.json());

io.on("connection", (socket) => {
  let currentUserId: string | null = null;

  socket.on("identity", async (userId) => {
    if (!userId) return;

    currentUserId = userId;
    socket.join(userId);

    try {
      await axios.post(`${FRONTEND_URL}/api/socket/connect`, {
        userId,
        socketId: socket.id,
      });
      socket.emit("identity");
    } catch (err: any) {}
  });

  socket.on("join-order", (orderId) => {
    const roomName = `order_${orderId}`;
    socket.join(roomName);
    socket.emit("joined-order", { orderId, room: roomName });
  });

  socket.on("deli-loc", ({ orderId, lat, lon }) => {
    if (!orderId || lat === undefined || lon === undefined) return;
    const roomName = `order_${orderId}`;
    io.to(roomName).emit("deli-loc", { orderId, lat, lon });
  });

  socket.on("leave-order", (orderId) => {
    const roomName = `order_${orderId}`;
    socket.leave(roomName);
  });

  socket.on("orders", async (data) => {
    try {
      if (!currentUserId || currentUserId !== data.userId) return;

      const shop = await axios.post(
        `${FRONTEND_URL}/api/user/order`,
        data
      );

      const orderId = shop.data.order._id;

      const fullOrder = await axios.get(
        `${FRONTEND_URL}/api/user/order?orderId=${orderId}`
      );

      io.to(data.userId).emit("new-order", fullOrder.data);
      io.to(data.userId).emit("status", fullOrder.data.status);
      io.to(data.userId).emit("join-this-order", orderId);

      const adminSockets = await io.in("admin").fetchSockets();
      if (adminSockets.length > 0) {
        io.to("admin").emit("admin-new-order", fullOrder.data);
      }
    } catch (err: any) {}
  });

  socket.on("payment", async ({ orderItems, total, userId, address }) => {
    try {
      const { data } = await axios.post(
        `${FRONTEND_URL}/api/user/payment`,
        {
          userId,
          items: orderItems,
          paymentMethod: "online",
          totalAmount: total,
          address,
        }
      );

      socket.emit("payment-url", data.url);
    } catch (err: any) {}
  });

  socket.on("update-location", async ({ userId, latitude, longitude }) => {
    try {
      if (!userId || latitude === undefined || longitude === undefined) return;

      await axios.post(
        `${FRONTEND_URL}/api/socket/geoupdater`,
        {
          userId,
          latitude,
          longitude,
        }
      );
    } catch (err: any) {}
  });

  socket.on("disconnect", () => {});
});

app.post("/notify", (req, res) => {
  const { socketId, event, data } = req.body;

  if (socketId) {
    io.to(socketId).emit(event, data);
  } else {
    io.emit(event, data);
  }

  return res.status(200).json({ success: true });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", connections: io.engine.clientsCount });
});

server.listen(port, () => {});
