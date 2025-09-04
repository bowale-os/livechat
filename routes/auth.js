const express = require('express');
const router = express.Router();
const passport = require('passport');

// ...local register/login routes...

router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    
    req.session.username = req.user.username;   // 👈 Save it for socket access
    req.session.userId = req.user._id;
    res.redirect('/welcome');
  }
);

module.exports = router;
