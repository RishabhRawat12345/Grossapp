import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import connectDb from "@/app/lib/Db"
import User from "@/app/models/user.model"
import bcrypt from "bcryptjs"
import Google from "next-auth/providers/google"
export const { handlers, signIn, signOut, auth} = NextAuth({
  providers: [
      Credentials({
        credentials:{
            username:{label:"Username"},
            email:{label:"email",type:"email"},
            password:{label:"Password",type:"password"}
        },
        async authorize(credentials,req){
                await connectDb();
                const email=credentials.email
                const password=credentials.password as string
                const user=await User.findOne({email})
                if(!user){
                    throw new Error("user is not exisit")
                }
                const isMatch=await bcrypt.compare(password,user.password)

                if(!isMatch){
                    throw new Error("incorrect_password")
                }
                return{
                    id:user._id.toString(),
                    email:user.email,
                    name:user.name,
                    role:user.role
                }
        }
    }),
    Google({
      clientId:process.env.GOOGLE_CLIENT_ID,
      clientSecret:process.env.GOOGLE_CLIENT_SECRET
    })
  ],
  callbacks:{
    //token ke ander user ka data dalta hai
    async signIn({user,account}){
       if(account?.provider=="google"){
        await connectDb()
        let dbuser=await User.findOne({email:user.email})
        console.log(dbuser)
        if(!dbuser){
          dbuser=await User.create({
            name:user.name,
            email:user.email,
            image:user.image
          })
        }
        user.id=dbuser._id.toString()
        user.role=dbuser.role
       }
       return true
    },
    jwt({token,user,trigger,session}){
       if(user){
        token.id=user.id;
        token.name=user.name;
        token.email=user.email;
        token.role=user.role
       }
       if(trigger==="update"){
         console.log("the update t",session);
         token.role=session.role
         console.log("the after update t",token);
       }
       return token;
    },
    session({session,token}){
      if(session.user){
        session.user.id=token.id as string,
        session.user.name=token.name as string,
        session.user.email=token.email as string,
        session.user.role=token.role as string
      }
      return session
    }
  },
  pages:{
    signIn:"/Login",
    error:"/Login",
  },
  session:{
    strategy:"jwt",
    maxAge:10*24*60*60*1000
  },
  secret:process.env.AUTH_SECRET
}) 