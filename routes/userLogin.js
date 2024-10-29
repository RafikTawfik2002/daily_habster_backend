import express from 'express';
import { User } from '../models/user.js';
import { Habit } from '../models/habit.js';
import { ObjectId } from "mongodb"
import bcrypt from 'bcryptjs'
import nodemailer from "nodemailer"
import { Code } from "../models/Code.js"
import dotenv from "dotenv"
import crypto from "crypto"
import { Token } from '../models/Token.js';
import jwt from "jsonwebtoken"
import { config } from 'dotenv';
import { request } from 'http';

config(); // Load environment variables from .env

const isProduction = process.env.NODE_ENV === 'production';
const secretKey = process.env.JWT_KEY

const router = express.Router();


dotenv.config()

// takes in a username and returns a userID after verifying the token and its identity
const verifyByUsername = async (request, username) => {
    const token = request.cookies.authToken;
    const userID = jwt.verify(token, secretKey, async (err, decoded) => {
        if (err) {
            return -1
        }
        const userID = decoded.userID 
        // if token is verified and decoded check userID matches userName
        const tokenUsername = (await User.findById(userID)).userName
        if(tokenUsername != username){return -1}
        
        return userID
    });
    return userID
    
}

// Creating a new user, used for signing up users  ===> GENERATES A TOKEN

router.post('/', async (request, response) => {
    try {
        //INPUT VALIDATION
        if (!request.body.userID || !request.body.email || !request.body.passWord || !request.body.userName){
            return response.status(400).send({message: 'Send all required fields'});
        }

        const newID = new ObjectId(request.body.userID)

        // CHECK IF EMAIL OR USERNAME ALREADY EXIST
        let error = ''
        // CHECK IF USERNAME EXISTS
        const found = await User.find({userName: request.body.userName}).exec() 

        if(found.length > 0){error = 'username taken'}
        // CHECK IF EMAIL EXISTS
        const foundEmail = await User.find({email: request.body.email}).exec() 
        if(foundEmail.length > 0){
            if(error != ''){error += ' and email already registered'}
            else{error = 'email already registered'}
        }
        // RAISE AN ERROR IF EMAIL OR USERNAME ALREADY TAKEN
        if(error != ''){throw new Error(error)}

        // ENCRYPT THE PASSWORD
        const hashedPassword = await bcrypt.hash(request.body.passWord, 10);

        // INTIALIZE NEW USER TO ADD TO THE DATABASE
        const newUser = {
            _id: newID,
            userID: newID,
            userName: request.body.userName,
            email: request.body.email,
            passWord: hashedPassword,
            verified: false
        };

        // GENERATE A TOKEN
        const token = jwt.sign({ userID: newID }, process.env.JWT_KEY, { expiresIn: '30d' });
        response.cookie('authToken', token, {
            httpOnly: true,      // Prevents JavaScript access (XSS protection)
            secure: true,         // Only sent over HTTPS
            sameSite: 'None',   // CSRF protection
            maxAge: 30 * 24 * 60 * 60 * 1000, // 7-day expiration
        });

  


        const user = await User.create(newUser); //using a mongoose.model which has a mongoose Schema

        const modifiedUser = {
            userID: request.body.userName,
            userName: request.body.userName,
            email: request.body.email,
            passWord: hashedPassword,
            verified: false
        }
        const demoHabit = await Habit.create(
            {
                desc: "Demo Habit",
                archived: false,
                success: false,
                discrete: false,
                userID: newID,
                duration: 10,
                lastLogin: 4,
                createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
                text: "This is a demo habit, feel free to deleted and make your own :-)"

            }
        )

        return response.status(201).send(modifiedUser);
    } catch (error) {
        console.log(error.message);
        response.status(500).send({ message: error.message });
    }
});

// authenticating user, used for user login  ===> GENERATES A TOKEN

router.post('/authenticate', async (request, response) => {
    try {
        //INPUT VALIDATION 
        if (!request.body.username || !request.body.password){
            return response.status(400).send({message: 'Send all required fields'});
        }
        //CHECK USER EXISTS
        const found = await User.find({userName: request.body.username}).exec() 
        if(found.length == 0){throw new Error('username or password are incorrect');}

        //CHECK IF PASSWORD MATCHED
        const user = found[0]
        const password = user.passWord
        const isMatch = await bcrypt.compare(request.body.password, password)
        if(!isMatch){throw new Error('username or password are incorrect');}

        //GENERATE AND SEND COOKIE TOKEN ==> contains userID and lasts for 30 days
        const token = jwt.sign({ userID: user.userID }, process.env.JWT_KEY, { expiresIn: '30d' });
        response.cookie('authToken', token, {
            httpOnly: true,      
            secure: true,                       // Only sent over HTTPS
            sameSite: 'None',   
            maxAge: 30 * 24 * 60 * 60 * 1000,    // 30-day expiration
        });
    
        //DATA TO SEND THE FRONTEND
        const res = {
            userID: user.userName,
            userName: user.userName,
            email: user.email,
            createdAt: user.createdAt,
            verified: user.verified
        }

        return response.status(201).send(res);
    } catch (error) {
        console.log(error.message);
        response.status(500).send({ message: error.message });
    }
});

// used to update a password

router.put('/password/:id', async (request, response) => {
    try{
        if(!request.body.password || !request.body.oldPassword){throw new Error("send both old and new passwords")}
        const { id } = request.params;

        const userID = await verifyByUsername(request, id)
        if(userID == -1 || (!userID))  return response.status(401).send('Invalid token');

        // find the user and check if password matches
        const found = await User.find({_id: userID}).exec() 

        if(found.length == 0){throw new Error('user not found error');}

        const user = found[0]
        const password = user.passWord

        const isMatch = await bcrypt.compare(request.body.oldPassword, password)

        if(!isMatch){throw new Error('old password is incorrect');}
        
        // old password match, encrypt new password and update the user

        const hashedPassword = await bcrypt.hash(request.body.password, 10);
        
        const updated = await User.findByIdAndUpdate(userID, {passWord: hashedPassword},  { new: true, runValidators: true })


        return response.status(200).json(updated);
    } catch (error){
        console.log(error.message);
        response.status(500).send({ message: error.message });

    }
})

// used to update username and email 

router.put('/:id', async (request, response) => {
    try{

        if(!request.body.userName || !request.body.email){throw new Error("send all information")}
        const { id } = request.params;

  
        const userID = await verifyByUsername(request, id)
        if(userID == -1 || (!userID))  return response.status(401).send('Invalid token');



        const currUser = await User.findById(userID)
        // check if email or username exists
        let error = ''
        // check if username exists
        const found = await User.find({userName: request.body.userName}).exec() 

        if(found.length == 1 && request.body.userName != currUser.userName){error = 'username taken'}
        // check if email exists
        const foundEmail = await User.find({email: request.body.email}).exec() 
        if(foundEmail.length == 1 && request.body.email != currUser.email){
            if(error != ''){error += ' and email already registered'}
            else{error = 'email already registered'}
        }
        // raise error if error is not empty
        if(error != ''){throw new Error(error)}

        
        const newInfo = {
            userName: request.body.userName,
            email: request.body.email,
            verified: currUser.email == request.body.email
        }

        const user = await User.findByIdAndUpdate(userID, newInfo,  { new: true, runValidators: true })


        return response.status(200).json(user);
    } catch (error){
        console.log(error.message);
        response.status(500).send({ message: error.message });

    }
})

// user to delete account

router.delete('/:id', async (request, response) => {
    try {
        const { id } = request.params;

        const userID = await verifyByUsername(request, id)
        if(userID == -1 || (!userID))  return response.status(401).send('Invalid token');

        const result = await User.findByIdAndDelete(userID);
        const userHabits = await Habit.find({userID: userID}) 
        
        // deleting associated habits
        userHabits.forEach(async (habit) => {
            await Habit.findByIdAndDelete(habit._id)

        });

        // delete any associated code

        if(!result){
            return response.status(404).json({ message: 'User not found '});
        }

        return response.status(200).send({ message: 'User deleted successfully' });
        
    } catch (error) {
        console.log(error.message);
        response.status(500).send({ message: error.message });
    }
})

// use to logout

router.post('/logout', async (request, response) => {
  
  response.cookie('token', '', {
    httpOnly: true, 
    secure: true,
    expires: new Date(0) 
  });
  
  response.status(200).json({ message: 'Logged out successfully' });
})


// ===================================================================================
// EMAIL VERIFICATION
// ===================================================================================

// takes userID token and an email and checks if information is matching
const verifyByEmail = async (request, email) => {
    const token = request.cookies.authToken;
    const userID = jwt.verify(token, secretKey, async (err, decoded) => {
        if (err) {
            return -1
        }
        const userID = decoded.userID 
        // if token is verified and decoded check userID matches userName
        const tokenEmail = (await User.findById(userID)).email
        if(tokenEmail != email){return -1}
        
        return userID
    });
    return userID
    
}

// setting up mail transporter
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: 'dailyhabster@gmail.com',
      pass: "oqpjznmiykesyrta",
    },
  });

  
// email html template for email verification 

const emailTemplate = (verificationCode) => {return (`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Email Verification</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
          }
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
          }
          .email-header {
            background-color: #4caf50;
            padding: 10px;
            text-align: center;
            color: white;
            border-top-left-radius: 8px;
            border-top-right-radius: 8px;
          }
          .email-body {
            padding: 20px;
            text-align: center;
          }
          .verification-code {
            font-size: 24px;
            font-weight: bold;
            color: #333;
            background-color: #f0f0f0;
            padding: 10px;
            border-radius: 5px;
            display: inline-block;
            letter-spacing: 4px;
          }
          .email-footer {
            margin-top: 20px;
            font-size: 12px;
            color: #888;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="email-header">
            <h2>Email Verification</h2>
          </div>
          <div class="email-body">
            <p>Hello,</p>
            <p>Thank you for signing up! Please use the following code to verify your email address:</p>
            <div class="verification-code">${verificationCode}</div>
            <p>This code is valid for the next 10 minutes.</p>
          </div>
          <div class="email-footer">
            <p>If you did not request this email, please ignore it.</p>
          </div>
        </div>
      </body>
    </html>
    `)}

// generate verification code
const verificationCode = () => {
    let code = ""
    for(let i = 0; i < 6; i++){
        code += Math.floor(Math.random() * 10);
    }
    return code
}
// ESSINTAIL ROUTES FOR THE APPLICATION

// send verification code  ==> NEEDS A TOKEN
router.post('/sendmail', async (request, response) => {
    try{
       

        // INPUT VALIDATION
        if(!request.body.email){return response.status(400).send({message: 'no email provided'})}
        

        const userID = await verifyByEmail(request, request.body.email)
        if(userID == -1 || (!userID))  return response.status(401).send('Invalid token');


        // GENERATE CODE
        const code = verificationCode()
        const found = await Code.find({email: request.body.email}).exec() 
        if(found.length >= 1){
            const entry = found[0]
            const res = await Code.findByIdAndUpdate(entry._id, {code: code}) 
        }
        else{
            await Code.create({email: request.body.email, code: code})
        }

        // SENDING THE CODE BY EMAIL
        const info = await transporter.sendMail({
            from: 'dailyhabster@gmail.com', // sender address
            to: request.body.email, // list of receivers
            subject: "Email Verification", // Subject line
            text: request.body.text, // plain text body
            html: emailTemplate(code), // html body
          });

          return response.status(200).json({success: "true"});

    } catch (error){
        console.log(error)
        response.status(500).send({ message: error.message });
    }
})

// check if a code is already sent
router.post('/sentcheck', async (request, response) => {
    try{if(!request.body.email){return response.status(400).send({message: 'no email provided'})}


        const userID = await verifyByEmail(request, request.body.email)
        if(userID == -1 || (!userID))  return response.status(401).send('Invalid token');

        const found = await Code.find({email: request.body.email}).exec() 

        if(found.length >= 1){
            return response.status(200).json({sent: true});
        }
        else{
            return response.status(200).json({sent: false});
        }
    }
    catch (error){
        console.log(error)
        response.status(500).send({ message: error.message });
    }

}
)

// verify email against verification code
router.post('/verify', async (request, response) => {
    try{if(!request.body.email || !request.body.code) { throw new Error("Send all required field")}

    const userID = await verifyByEmail(request, request.body.email)
    if(userID == -1 || (!userID))  return response.status(401).send('Invalid token');

    const found = await Code.find({email: request.body.email}).exec()
    if(found.length == 0){throw new Error("No token was issued")}

    
    const elapsedMinutes =  (new Date().getTime() - new Date(found[0].updatedAt).getTime())/(1000*60) 


    
    if(found[0].code == request.body.code){
        if(elapsedMinutes > 11){throw new Error("this code has expired")}
        const find = await User.find({email: request.body.email}).exec()

        const userID = find[0]._id
        const res = await User.findByIdAndUpdate(userID, {verified: true})
        await Code.findByIdAndDelete(found[0]._id)
        return response.status(200).json(res);
    }
    else{
        throw new Error("Verification failed")
    }
    }
    catch (error) {
        console.log(error)
        response.status(500).send({ message: error.message });
    }

})


// ===================================================================================
// ACCOUNT RECOVERY
// ===================================================================================


// takes a token and validates it and updates the password  ==> DOES NOT NEED A TOKEN
router.post('/resetpass', async (request, response) => {
    try{

    if(!request.body.password || !request.body.token){return response.status(400).send({message: 'send all fields'})}
    const found = await Token.find({token: request.body.token})
    if(found.length == 0){return response.status(400).send({message: 'no token found'})}
 
    const userID = found[0].userID
    const createdAt = found[0].createdAt
    if((new Date().getTime() - new Date(createdAt).getTime())/(1000*60) > 11){

        await Token.findByIdAndDelete(found[0]._id)
        return response.status(400).send({message: 'token expired'})
    } 
    const user = await User.find({userID: userID})
    if(user.length == 0){return response.status(400).send({message: 'no user found'})}
    const idToReset = user[0]._id


    const hashedPass = await bcrypt.hash(request.body.password, 10);

    const update = await User.findByIdAndUpdate(idToReset, {passWord: hashedPass})
    await Token.findByIdAndDelete(found[0]._id)

    return response.status(200).send({message: 'success', update})
    } catch (error){
        const found = await Token.find({token: request.body.token})
        const deleted = await Token.findByIdAndDelete(found[0]._id)

        console.log(error)
        response.status(500).send({message: "error"} );
    }
    
})
// password reset
const passwordResetTemplate = (link) => {return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 20px;
        }
        .container {
            background-color: #ffffff;
            padding: 20px;
            border-radius: 5px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            max-width: 600px;
            margin: 0 auto;
        }
        .header {
            background-color: #4CAF50;
            color: #ffffff;
            padding: 10px;
            text-align: center;
            border-radius: 5px 5px 0 0;
        }
        .content {
            padding: 20px;
            text-align: center;
        }
        .reset-btn {
            display: inline-block;
            padding: 10px 20px;
            font-size: 16px;
            color: #ffffff;
            background-color: #4CAF50;
            text-decoration: none;
            border-radius: 5px;
            margin-top: 20px;
        }
        .footer {
            margin-top: 20px;
            text-align: center;
            font-size: 12px;
            color: #999999;
        }
    </style>
</head>
<body>

    <div class="container">
        <div class="header">
            <h1>Password Reset</h1>
        </div>
        <div class="content">
            <p>Hello,</p>
            <p>You requested to reset your password. Click the button below to proceed:</p>
            <a href="${link}" class="reset-btn" style="color: #ffffff; text-decoration: none;">Reset Password</a>
            
        </div>
        <div class="footer">
            <p>If you didn't request this, please ignore this email.</p>
        </div>
    </div>

</body>
</html>`}

router.post('/resetrequest', async (request, response) => {

   try { if(!request.body.email || !request.body.link){return response.status(400).send({message: 'send all fields'})}

    const user = await User.find({email: request.body.email})
    if(user.length == 0){return response.status(400).send({message: 'no user exists'})}

    const userID = user[0].userID


    const email = request.body.email

    const token = crypto.randomBytes(32).toString('hex');
    const found = await Token.find({userID: userID})
    if(found.length >= 1){
        const entry = found[0]
        const res = await Token.findByIdAndUpdate(entry._id, {token: token})

    }
    else{
    await Token.create({token: token, userID: userID}) 
    }
    const info = await transporter.sendMail({
        from: 'dailyhabster@gmail.com', // sender address
        to: email, // list of receivers
        subject: "Reset Password", // Subject line
        text: "", // plain text body
        html: passwordResetTemplate(request.body.link + "/" + token), // html body
      });


      return response.status(200).json({success: "true", link: request.body.link + "/" + token});

    } catch (error){
    console.log(error)
    response.status(500).send({ message: error.message });
}
    
    
})

// check if token exists 
router.post('/checktoken', async (request, response) => {
    try{
        if(!request.body.token) {throw new Error("no token found")}
        const token = request.body.token
        const found = await Token.find({token: token})
        response.status(200).send({ found: found.length == 1 });

    } catch (error){
        console.log(error)
        response.status(500).send({ found: false });
    }
})

// Username revocery
const usernameTemplate = (username) => {return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Username Recovery</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 20px;
        }
        .container {
            background-color: #ffffff;
            padding: 20px;
            border-radius: 5px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            max-width: 600px;
            margin: 0 auto;
        }
        .header {
            background-color: #4CAF50;
            color: #ffffff;
            padding: 10px;
            text-align: center;
            border-radius: 5px 5px 0 0;
        }
        .content {
            padding: 20px;
            text-align: center;
        }
        .username {
            font-size: 18px;
            font-weight: bold;
            color: #333333;
        }
        .footer {
            margin-top: 20px;
            text-align: center;
            font-size: 12px;
            color: #999999;
        }
    </style>
</head>
<body>

    <div class="container">
        <div class="header">
            <h1>Username Recovery</h1>
        </div>
        <div class="content">
            <p>Hello,</p>
            <p>It looks like you've requested to recover your username.</p>
            <p>Your username is:</p>
            <p class="username">${username}</p> <!-- Replace {{username}} with the actual username -->
            <p>If you didn't request this, please ignore this email.</p>
        </div>
    </div>

</body>
</html>
`}
router.post('/forgotusername', async (request, response) => {
    try{
        if(!request.body.email){return response.status(400).send({message: 'no email provided'})}
        const found = await User.find({email: request.body.email}).exec()
        if(found == 0){throw new Error("User does not exist")}
        const user = found[0]

        const info = await transporter.sendMail({
            from: 'dailyhabster@gmail.com', // sender address
            to: request.body.email, // list of receivers
            subject: "Username Recovery", // Subject line
            text: request.body.text, // plain text body
            html: usernameTemplate(user.userName), // html body
          });


          return response.status(200).json({success: "true"});
    }catch (error){
        console.log(error)
        response.status(500).send({ message: error.message });
    }
    
})

// ===================================================================================
// NON-ESSENTIAL routes used for testing
// ===================================================================================

// get method for getting users

// router.get('/', async (request, response) => {
//     try{
//         const user = await User.find({});
//         return response.status(200).json({
//             count: user.length,
//             data: user
//         });
//     } catch (error){
//         console.log(error.message);
//         response.status(500).send({ message: error.message });

//     }
// })

// Getting user by id

// router.get('/:id', async (request, response) => {
//     try{

//         const { id } = request.params;
//         const user = await User.findById(id);

//         return response.status(200).json(user);
//     } catch (error){
//         console.log(error.message);
//         response.status(500).send({ message: error.message });

//     }
// })

// Getting user by username

// router.get('/username/:username', async (request, response) => {
//     try{

//         const { username } = request.params;
//         const user = await User.find({userName: username});

//         return response.status(200).json(user);
//     } catch (error){
//         console.log(error.message);
//         response.status(500).send({ message: error.message });

//     }
// })

export default router
