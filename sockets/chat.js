const Message = require('../models/Message');
const User = require('../models/User');

const onlineUsers = {};
const sessionToMongoId = {}; // Map session IDs to MongoDB ObjectIds

module.exports = function(io) {
  io.on('connection', async (socket) => {
    try {
      const sessionUserId = socket.handshake.session?.passport?.user;
      console.log("Socket authenticated sessionUserId:", sessionUserId);
      
      if (!sessionUserId) {
        console.log("No user ID found in session");
        socket.disconnect();
        return;
      }

      const user = await User.findById(sessionUserId);
      if (!user) {
        console.log("User not found:", sessionUserId);
        socket.disconnect();
        return;
      }

      console.log(`User connected: ${user.username}`);

      // Store mapping from session ID to MongoDB ObjectId
      sessionToMongoId[sessionUserId] = user._id;

      onlineUsers[user._id] = {
        socketId: socket.id,
        username: user.username,
        profilePic: user.profilePic,
        sessionUserId: sessionUserId
      };

      // Send current online users to the new user (excluding current user)
      console.log('Current user ID:', user._id.toString());
      console.log('Online users keys:', Object.keys(onlineUsers));
      
      const currentOnlineUsers = Object.entries(onlineUsers)
        .filter(([mongoId, userData]) => {
          console.log('Comparing:', mongoId, 'with', user._id.toString(), 'Result:', mongoId !== user._id.toString());
          return mongoId !== user._id.toString();
        })
        .map(([mongoId, userData]) => ({
          userId: mongoId,
          username: userData.username,
          profilePic: userData.profilePic ? `/proxy/profile-pic/${mongoId}` : null
        }));
      
      console.log('Filtered online users:', currentOnlineUsers);
      socket.emit('currentOnlineUsers', currentOnlineUsers);

      io.emit('userOnline', {
        userId: user._id,
        username: user.username,
        profilePic: user.profilePic ? `/proxy/profile-pic/${user._id}` : null
      });

      // Handle chat messages
      socket.on('chat message', async (data) => {
        try {
          const message = await Message.create({
            user: user._id,  // Use user._id instead of userId
            content: data.content
          });
          
          io.emit('chat message', {
            username: user.username,
            content: data.content,
            timestamp: message.timestamp
          });
        } catch (error) {
          console.error('Error saving message:', error);
        }
      });

      // Handle chat requests
      socket.on('chat_request', async (data) => {
        try {
          console.log(`Chat request from ${user.username} to ${data.toUsername}`);
          
          // Find the target user's socket by MongoDB ObjectId
          const targetUserData = onlineUsers[data.toUserId];
          if (!targetUserData) {
            console.log('Target user not found or offline');
            return;
          }

          // Send notification to target user
          io.to(targetUserData.socketId).emit('chat_notification', {
            fromUserId: user._id,
            fromUsername: user.username,
            fromProfilePic: user.profilePic,
            message: `${user.username} wants to chat with you!`,
            timestamp: new Date()
          });

          console.log(`Chat notification sent to ${data.toUsername}`);
        } catch (error) {
          console.error('Error handling chat request:', error);
        }
      });

      // Handle chat request responses
      socket.on('chat_response', async (data) => {
        try {
          console.log(`Chat response from ${user.username} to ${data.toUsername}: ${data.response}`);
          
          // Find the original requester's socket
          const requesterUserData = onlineUsers[data.toUserId];
          if (!requesterUserData) {
            console.log('Original requester not found or offline');
            return;
          }

          // Send response back to original requester
          io.to(requesterUserData.socketId).emit('chat_response_notification', {
            fromUserId: user._id,  // Use user._id instead of userId
            fromUsername: user.username,
            response: data.response, // 'accepted' or 'declined'
            message: data.response === 'accepted' 
              ? `${user.username} accepted your chat request!` 
              : `${user.username} declined your chat request.`,
            timestamp: new Date()
          });

          console.log(`Chat response sent to ${data.toUsername}`);
        } catch (error) {
          console.error('Error handling chat response:', error);
        }
      });

      // Handle private messages
      socket.on('private_message', async (data) => {
        try {
          console.log(`Private message from ${user.username} to ${data.toUserId}: ${data.content}`);
          
          // Prevent sending message to yourself
          if (data.toUserId === user._id.toString()) {
            console.log('User attempted to message themselves');
            return;
          }
          
          // Find the target user's socket
          const targetUserData = onlineUsers[data.toUserId];
          if (!targetUserData) {
            console.log('Target user not found or offline');
            return;
          }

          // Save message to database
          const message = await Message.create({
            user: user._id,
            content: data.content,
            recipient: data.toUserId,
            isPrivate: true
          });

          // Send to target user
          io.to(targetUserData.socketId).emit('private_message', {
            fromUserId: user._id,
            fromUsername: user.username,
            content: data.content,
            timestamp: message.timestamp
          });

          // Send notification to target user (even if they're not in chat)
          io.to(targetUserData.socketId).emit('new_message_notification', {
            fromUserId: user._id,
            fromUsername: user.username,
            fromProfilePic: user.profilePic,
            content: data.content,
            timestamp: message.timestamp
          });

          console.log(`Private message sent to ${targetUserData.username}`);
        } catch (error) {
          console.error('Error handling private message:', error);
        }
      });

      socket.on('disconnect', () => {
        delete onlineUsers[user._id];
        delete sessionToMongoId[sessionUserId];
        io.emit('userOffline', user._id);
        console.log(`User disconnected: ${user.username}`);
      });
    } catch (error) {
      console.error('Socket connection error:', error);
      socket.disconnect();
    }
  });
};

