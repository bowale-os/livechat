require('dotenv').config();

const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

const session = require('express-session');
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 't3rin@t0r', // Use env for security
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using HTTPS in production
});
const sharedsession = require('express-socket.io-session');
const passport = require('passport');  

// ==== CONFIG & MODELS ====
require('./config/database');   // Sets up MongoDB connection
require('./config/passport');     // Sets up Passport strategies
const User = require('./models/User');
const Message = require('./models/Message');


// ==== MIDDLEWARE ORDER MATTERS! ====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);                 // Session first
app.use(passport.initialize());
app.use(passport.session());
io.use(sharedsession(sessionMiddleware));    // Share session with socket.io

// ==== ROUTES ====
app.use('/', require('./routes/auth'));

// ==== STATIC FILES ====
app.use(express.static('public'));           // Serve static assets if needed

// ==== SOCKETS ====
require('./sockets/chat')(io);               // Pass server instance to sockets

// ==== UTILITY MIDDLEWARE (if needed) ====
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).send('Unauthorized');
  next();
}

// ==== SAMPLE PROTECTED ROUTES ====
app.get('/chat', requireLogin, (req, res) => {
  res.sendFile(__dirname + '/chat.html');
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/home.html');
});

app.get('/welcome', requireLogin, (req, res) => {
  res.sendFile(__dirname + '/welcome.html');
});

app.get('/me', requireLogin, (req, res) => {
  res.json({ username: req.user.username, _id: req.user._id });
});

// Get chat history for the current user
app.get('/chat-history', requireLogin, async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Find all private messages where the user is either sender or recipient
    const messages = await Message.find({
      $or: [
        { user: userId, isPrivate: true },
        { recipient: userId, isPrivate: true }
      ]
    })
    .populate('user', 'username profilePic')
    .populate('recipient', 'username profilePic')
    .sort({ timestamp: -1 })
    .limit(50); // Limit to last 50 messages
    
    // Group messages by conversation partner
    const conversations = {};
    
    for (const message of messages) {
      const isSender = message.user._id.toString() === userId.toString();
      
      let partnerId, partnerUsername, partnerProfilePic;
      
      if (isSender) {
        // Current user is sender, so partner is recipient
        if (message.recipient && typeof message.recipient === 'object') {
          // Recipient is populated
          partnerId = message.recipient._id;
          partnerUsername = message.recipient.username;
          partnerProfilePic = message.recipient.profilePic;
        } else {
          // Recipient is just an ID string - fetch user info
          const recipientUser = await User.findById(message.recipient).select('username profilePic');
          partnerId = message.recipient;
          partnerUsername = recipientUser ? recipientUser.username : 'Unknown User';
          partnerProfilePic = recipientUser ? recipientUser.profilePic : null;
        }
      } else {
        // Current user is recipient, so partner is sender
        partnerId = message.user._id;
        partnerUsername = message.user.username;
        partnerProfilePic = message.user.profilePic;
      }
      
      if (!conversations[partnerId]) {
        conversations[partnerId] = {
          userId: partnerId,
          username: partnerUsername,
          profilePic: partnerProfilePic,
          lastMessage: message.content,
          lastMessageTime: message.timestamp,
          unreadCount: 0 // We'll implement this later
        };
      } else {
        // Update with most recent message
        if (message.timestamp > conversations[partnerId].lastMessageTime) {
          conversations[partnerId].lastMessage = message.content;
          conversations[partnerId].lastMessageTime = message.timestamp;
        }
      }
    }
    
    // Convert to array and sort by last message time
    const chatHistory = Object.values(conversations).sort((a, b) => 
      new Date(b.lastMessageTime) - new Date(a.lastMessageTime)
    );
    
    res.json(chatHistory);
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Get messages for a specific conversation
app.get('/messages/:userId', requireLogin, async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const otherUserId = req.params.userId;
    
    // Find all messages between these two users
    const messages = await Message.find({
      $or: [
        { user: currentUserId, recipient: otherUserId, isPrivate: true },
        { user: otherUserId, recipient: currentUserId, isPrivate: true }
      ]
    })
    .populate('user', 'username profilePic')
    .sort({ timestamp: 1 }) // Oldest first
    .limit(100); // Limit to last 100 messages
    
    // Format messages for frontend
    const formattedMessages = messages.map(message => ({
      id: message._id,
      content: message.content,
      sender: message.user._id.toString() === currentUserId.toString() ? 'me' : 'other',
      timestamp: message.timestamp,
      username: message.user.username
    }));
    
    res.json(formattedMessages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Proxy route for Google profile pictures
app.get('/proxy/profile-pic/:userId', requireLogin, async (req, res) => {
  try {
    // Find user by session userId (which is stored in onlineUsers)
    const user = await User.findById(req.params.userId);
    if (!user || !user.profilePic) {
      return res.status(404).send('Profile picture not found');
    }
    
    // Fetch the image from Google and serve it
    const response = await fetch(user.profilePic);
    if (!response.ok) {
      return res.status(404).send('Profile picture not found');
    }
    
    const buffer = await response.arrayBuffer();
    res.set('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Profile picture proxy error:', error);
    res.status(500).send('Error loading profile picture');
  }
});

app.get('/logout', (req, res, next) => {
  req.logout(function(err) {  // Passport.js (asynchronous since v0.6.0)
    if (err) { return next(err); }
    req.session.destroy(() => {
      res.redirect('/'); // Redirect to welcome/home page
    });
  });
});


// ==== START SERVER (only one! no duplicates!) ====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


module.exports = { app, io };