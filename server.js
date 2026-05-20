require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = express();

//updated import to inclue restrictTo 
const { protect, restrictTo } = require('./middleware/authMiddleware')

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
// POST /api/transactions/transfer
app.post('/api/transactions/transfer', protect, async (req, res) => {
  const { fromAccountId, toAccountNumber, amount } = req.body;
  const transferAmount = parseFloat(amount);
   //  Basic Validation
  if (isNaN(transferAmount) || transferAmount <= 0) {
    return res.status(400).json({ error: "Amount must be a positive number" });
  }

  try {
    // 1. Start a Prisma Transaction
    const result = await prisma.$transaction(async (tx) => {
      
      // A. Find the sender's account and check balance
      const senderAccount = await tx.account.findUnique({
        where: { id: fromAccountId },
         include: { user: true } // Include user so we can log their name
      });

      if (!senderAccount || senderAccount.balance < transferAmount) {
        throw new Error("Insufficient funds or account not found");
      }

      // B. Find the receiver's account by Account Number
      const receiverAccount = await tx.account.findUnique({
        where: { accountNumber: toAccountNumber }
      });

      if (!receiverAccount) {
        throw new Error("Receiver account not found");
      }

      // not allowing Self tarnsfer 
      if (senderAccount.accountNumber === toAccountNumber) {
        throw new Error("You cannot transfer money to the same account");
      }

     // Updating the balance 
      await tx.account.update({
        where: { id: fromAccountId },
        data: { balance: { decrement: transferAmount } }
      });

      await tx.account.update({
        where: { id: receiverAccount.id },
        data: { balance: { increment: transferAmount } }
      });

      // C. Deduct from Sender
      // const updatedSender = await tx.account.update({
      //   where: { id: fromAccountId },
      //   data: { balance: { decrement: transferAmount } }
      // });

      // D. Add to Receiver
      // const updatedReceiver = await tx.account.update({
      //   where: { id: receiverAccount.id },
      //   data: { balance: { increment: transferAmount } }
      // });

      // E. Create the Transaction Record
      const transactionRecord = await tx.transaction.create({
        data: {
          amount: transferAmount,
          fromAccountId: senderAccount.id,
          toAccountId: receiverAccount.id,
          type: 'TRANSFER'
        }
      });
      // CREATE AUDIT LOG (The "Paper Trail")
      await tx.auditLog.create({
        data: {
          userId: req.user.id,
          action: `TRANSFER_CREATED`,
          ipAddress: req.ip,   // Express captures the IP automatically
          details: {           // Saving as a JSON object
            sender_account: senderAccount.accountNumber,
            receiver_account: toAccountNumber,
            amount: transferAmount,
            transaction_id: transactionRecord.id
          }
        }
      });

      return { transactionId: transactionRecord.id, 
        newBalance: senderAccount.balance.toNumber() - transferAmount };
    });

    res.json({ message: "Transfer successful!", data: result });

  } catch (error) {
    console.error("Transfer Error:", error.message);
    res.status(400).json({ error: error.message });
  }
});
// GET /api/admin/audit-logs
// ONLY Admins can see the global audit trail
app.get('/api/admin/audit-logs', protect, restrictTo('ADMIN'), async (req, res) => {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { fullName: true, email: true } } }
    });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});
// GET /api/accounts/:accountId/transactions
// Fetch the bank statement for a specific account
app.get('/api/accounts/:accountId/transactions', protect, async (req, res) => {
  const { accountId } = req.params;

  try {
    // SECURITY CHECK(Does this account actually belong to the logged-in user)
    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account || account.userId !== req.user.id) {
      return res.status(403).json({ error: "Access denied: This is not your account" });
    }

    // Fetch the Statement (Both sent and received)
    const transactions = await prisma.transaction.findMany({
      where: {
        OR: [
          { fromAccountId: accountId },
          { toAccountId: accountId }
        ]
      },
      orderBy: {
        createdAt: 'desc' // Newest transactions first
      },
      include: {
        fromAccount: { select: { accountNumber: true, user: { select: { fullName: true } } } },
        toAccount: { select: { accountNumber: true, user: { select: { fullName: true } } } }
      }
    });

    res.json({
      accountNumber: account.accountNumber,
      balance: account.balance,
      transactionCount: transactions.length,
      statement: transactions
    });

  } catch (error) {
    console.error("Statement Error:", error);
    res.status(500).json({ error: "Failed to fetch transaction history" });
  }
});
// POST /api/transactions/deposit
app.post('/api/transactions/deposit', protect, async (req, res) => {
  const { accountId, amount } = req.body;
  const depositAmount = parseFloat(amount);

  if (isNaN(depositAmount) || depositAmount <= 0) {
    return res.status(400).json({ error: "Invalid deposit amount" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Update Account Balance
      const updatedAccount = await tx.account.update({
        where: { id: accountId },
        data: { balance: { increment: depositAmount } }
      });

      // 2. Record as a Transaction (fromAccountId is NULL for deposits)
      const transaction = await tx.transaction.create({
        data: {
          amount: depositAmount,
          toAccountId: accountId,
          type: 'DEPOSIT'
        }
      });

      // 3. Log it
      await tx.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'DEPOSIT',
          ipAddress: req.ip,
          details: { amount: depositAmount, account: updatedAccount.accountNumber }
        }
      });

      return { newBalance: updatedAccount.balance, transactionId: transaction.id };
    });

    res.json({ message: "Deposit successful", data: result });
  } catch (error) {
    res.status(400).json({ error: "Deposit failed" });
  }
});
// POST /api/transactions/withdraw

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 CBE Bank Server running on http://localhost:${PORT}`);
});