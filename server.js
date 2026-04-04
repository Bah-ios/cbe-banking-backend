require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = express();
const { protect } = require('./middleware/authMiddleware')

//  Prisma  Client Initialization
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

app.use(express.json());


//  Health Check
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "UP", database: "CONNECTED" });
  } catch (e) {
    res.status(500).json({ status: "DOWN", error: e.message });
  }
});


//  Register User + Auto-Create Bank Account
app.post('/api/users/register', async (req, res) => {
  
  console.log("Data received from Postman:", req.body); 
  const { email, fullName, password } = req.body;
  
  try {
    // This is a TRANSACTION: Both happen or nothing happens.
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = await bcrypt.hash(password, salt);  


    const result = await prisma.$transaction(async (tx) => {
      
      // A. Create the User
      const user = await tx.user.create({
        data: {
          email,
          fullName,
          passwordHash: hashedPassword, //unhashed pass
        },
      });

      // B. Create the Bank Account
      const account = await tx.account.create({
        data: {
          userId: user.id,
          accountNumber: "1000" + Math.floor(100000000 + Math.random() * 900000000),
          balance: 0.0,
        },
      });

      return { user, account };
    });
     delete result.user.passwordHash;


    res.status(201).json({
      message: "User and Bank Account created!",
      data: result,
    });
    


  } catch (error) {
    console.error("Registration Error:", error);
    res.status(400).json({ 
      error: "Registration failed", 
      details: error.message.includes("unique constraint") ? "Email already exists" : error.message 
    });
  }
});

app.post('/api/users/login', async(req, res) => {

  const {email, password} = req.body;

  try{
    const user = await prisma.user.findUnique({
      where : { email : email }
    });
    if(!user){
      return res.status(401).json({error : "Invalid Email or passowrd"});
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);

    if(!isMatch){
      return res.status(401).json({ error : "Invalid email or password"})
    }
    
    const token = jwt.sign(
      {userId : user.id, role : user.role},
      process.env.JWT_SECRET,
      { expiresIn : '1h'}
    );

     res.json({
      message: "Login successful",
      token: token
    });
  }
  catch(error){
    res.status(500).json({ error: "Login failed" });
  }

  
});

app.get('/api/users/profile', protect, async (req, res) => {
  try {
    // We get the user ID from the "protect" middleware
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        accounts: true, // This shows the user's bank accounts
      }
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: "Server error fetching profile" });
  }
});
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 CBE Bank Server running on http://localhost:${PORT}`);
});