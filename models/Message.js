const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // For private messages
    isPrivate: { type: Boolean, default: false } // To distinguish private from public messages
});

module.exports = mongoose.model('Message', messageSchema);
