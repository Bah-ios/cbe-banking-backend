const jwt = require('jsonwebtoken');

const protect = async (req, res, next) => {
  let token;

  // 1. Check if the Authorization header exists and starts with "Bearer"
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // 2. Get the token from the header (Format: "Bearer <token>")
      token = req.headers.authorization.split(' ')[1];

      // 3. Verify the token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // 4. Attach user info to the request object
      // This allows any route using this middleware to access req.user.id
      req.user = {
        id: decoded.userId,
        role: decoded.role
      };

      // 5. Move to the next piece of logic (the controller)
      next();
    } catch (error) {
      console.error("Not authorized, token failed");
      return res.status(401).json({ message: "Not authorized, token invalid" });
    }
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token provided" });
  }
};

// function restrict-to to add role based access(R-BAC
const restrictTo = (...roles) => {
  return (req, res, next) => {
    // req.user is set by the protect so i can use it here
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: "Forbidden: You do not have permission to perform this action" 
      });
    }
    next();
  };
};

module.exports = { protect, restrictTo }; //included restricTo to the export module 
