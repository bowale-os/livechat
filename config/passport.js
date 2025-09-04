const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User')

passport.serializeUser((user, done) => {
  done(null, user.id); // or the MongoDB id
});
passport.deserializeUser(async (id, done) => {
  const user = await User.findById(id); // assumes you have a User model
  done(null, user);
});

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "https://livechat-yt8y.onrender.com/auth/google/callback"
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      console.log('Google profile:', {
        id: profile.id,
        displayName: profile.displayName,
        photos: profile.photos?.length || 0
      });
      
      let user = await User.findOne({ googleId: profile.id });
      console.log('Existing user:', user ? 'found' : 'not found');
      
      if (!user) {
        // Get the best quality profile picture
        const profilePic = profile.photos && profile.photos.length > 0 
          ? profile.photos[0].value 
          : '';
        
        console.log('Profile picture URL:', profilePic);
        console.log('Profile picture URL type:', typeof profilePic);
        console.log('Profile picture URL length:', profilePic.length);
        
        user = await User.create({
          username: profile.displayName,
          googleId: profile.id,
          profilePic: profilePic
        });
        console.log('New user created:', user.username);
      } else {
        // Update existing user's profile picture if it's missing
        if (!user.profilePic && profile.photos && profile.photos.length > 0) {
          user.profilePic = profile.photos[0].value;
          await user.save();
          console.log('Updated profile picture for existing user');
        }
      } 
      return done(null, user);
    } catch (error) {
      console.error('Passport strategy error:', error);
      return done(error, null);
    }
  }
));


module.exports = passport;