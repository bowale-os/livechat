const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {type: String},
    googleId: {type: String, unique: true},
    profilePic: {type: String},
    messages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' }]
});


module.exports = mongoose.model('User', userSchema);