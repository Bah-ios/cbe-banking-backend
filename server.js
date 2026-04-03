require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');

const app = express();

//  Prisma  Client Initialization
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

app.use(express.json());

// 1. Health Check
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "UP", database: "CONNECTED" });
  } catch (e) {
    res.status(500).json({ status: "DOWN", error: e.message });
  }
});


// 2. Register User + Auto-Create Bank Account
app.post('/api/users/register', async (req, res) => {
  
  console.log("Data received from Postman:", req.body); 
  const { email, fullName, password } = req.body;

  try {
    // This is a TRANSACTION: Both happen or nothing happens.
    const result = await prisma.$transaction(async (tx) => {
      
      // A. Create the User
      const user = await tx.user.create({
        data: {
          email,
          fullName,
          passwordHash: password, //unhashed pass
        },
      });

      // B. Create the Bank Account
      const account = await tx.account.create({
        data: {
          userId: user.id,
          accountNumber: "CBE-" + Math.floor(100000000 + Math.random() * 900000000),
          balance: 0.0,
        },
      });

      return { user, account };
    });

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

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 CBE Bank Server running on http://localhost:${PORT}`);
});