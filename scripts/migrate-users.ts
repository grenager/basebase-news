import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  getDatabase,
  doc,
  setDoc,
  updateDoc,
  getDocs,
  collection,
  QueryDocumentSnapshot,
} from "basebase-js";

// Load environment variables from .env.local FIRST
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// Debug: Check if environment variables are loaded
console.log("Environment variables loaded:");
console.log("MONGODB_URI:", !!process.env.MONGODB_URI);
console.log("BASEBASE_TOKEN:", !!process.env.BASEBASE_TOKEN);
console.log("BASEBASE_API_KEY:", !!process.env.BASEBASE_API_KEY);
console.log("BASEBASE_PROJECT_ID:", !!process.env.BASEBASE_PROJECT_ID);

// Check required environment variables
if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI environment variable is required");
}
if (!process.env.BASEBASE_TOKEN) {
  throw new Error("BASEBASE_TOKEN environment variable is required");
}
if (!process.env.BASEBASE_API_KEY) {
  throw new Error("BASEBASE_API_KEY environment variable is required");
}
if (!process.env.BASEBASE_PROJECT_ID) {
  throw new Error("BASEBASE_PROJECT_ID environment variable is required");
}

// Create database instance with JWT token for server environment
const db = getDatabase(process.env.BASEBASE_TOKEN!);

// Debug: Check if token is configured
console.log("BaseBase initialized with token:", !!process.env.BASEBASE_TOKEN);

interface MongoUser {
  _id: string;
  first: string;
  last: string;
  phone?: string;
  imageUrl?: string;
  email: string;
  isAdmin: boolean;
  sourceIds: any[]; // ObjectIds from MongoDB
  denseMode: boolean;
  darkMode: boolean;
}

interface BaseBaseUser {
  name: string;
  phone: string;
  email?: string;
  imageUrl?: string;
}

interface NewsWithFriendsUser {
  sourceIds: string[];
  friends: string[];
  denseMode?: boolean;
  darkMode?: boolean;
}

async function connectToMongo(): Promise<{ client: MongoClient; db: any }> {
  console.log("Connecting to MongoDB...");
  const client = await MongoClient.connect(process.env.MONGODB_URI!);
  console.log("Connected successfully to MongoDB");
  return { client, db: client.db() };
}

async function buildPhoneToIdMapping(): Promise<Map<string, string>> {
  try {
    console.log("Building phone-to-ID mapping from existing BaseBase users...");
    const usersCollection = collection(db, "basebase/users");
    const usersSnap = await getDocs(usersCollection);
    console.log("Got users:", usersSnap.docs.length);

    const phoneToIdMap = new Map<string, string>();
    usersSnap.docs.forEach((userDoc: QueryDocumentSnapshot) => {
      const userData = userDoc.data() as any;
      console.log("User data:", userData);
      if (userData.phone) {
        phoneToIdMap.set(userData.phone, userDoc.id);
      }
    });

    console.log(
      `Found ${phoneToIdMap.size} existing users in BaseBase`,
      phoneToIdMap
    );
    return phoneToIdMap;
  } catch (error) {
    console.error("Error building phone-to-ID mapping:", error);
    return new Map();
  }
}

async function migrateUsers() {
  let mongoClient: MongoClient | undefined;

  try {
    // Connect to MongoDB and get users
    console.log("\nConnecting to MongoDB...");
    const { client, db: mongoDb } = await connectToMongo();
    mongoClient = client;

    console.log("Fetching users from MongoDB...");
    const rawUsers = await mongoDb.collection("users").find({}).toArray();
    const users: MongoUser[] = rawUsers;

    console.log(`Found ${users.length} users to migrate`);

    const phoneToIdMap = await buildPhoneToIdMapping();

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    let createdCount = 0;
    let updatedCount = 0;

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const progress = (((i + 1) / users.length) * 100).toFixed(1);

      console.log(
        `\n[${progress}%] Migrating user: ${user.first} ${user.last}`
      );

      try {
        if (!user.phone) {
          console.log(
            `✗ Skipping user "${user.first} ${user.last}" - no phone number`
          );
          skipCount++;
          continue;
        }

        console.log(`  📱 Phone: ${user.phone}`);
        console.log(`  📧 Email: ${user.email}`);
        console.log(`  📊 Source IDs: ${user.sourceIds?.length || 0}`);

        // Check if user exists in BaseBase users collection
        const existingUserId = phoneToIdMap.get(user.phone);
        const userId = existingUserId || user._id;

        // Prepare BaseBase user data (name, phone, email, imageUrl)
        const basebaseUserData: BaseBaseUser = {
          name: `${user.first} ${user.last}`,
          phone: user.phone,
          email: user.email,
          imageUrl: user.imageUrl,
        };

        // Prepare NewsWithFriends user data (sourceIds, friends, preferences)
        const newsWithFriendsUserData: NewsWithFriendsUser = {
          sourceIds: (user.sourceIds || []).map((id) => id.toString()),
          friends: [], // Initialize with empty friends array
          denseMode: user.denseMode || false,
          darkMode: user.darkMode || false,
        };

        if (existingUserId) {
          console.log(
            `  🔄 User exists in BaseBase (ID: ${existingUserId}) - updating`
          );

          // Update existing user in both collections
          const basebaseUserDoc = doc(db, `basebase/users/${existingUserId}`);
          await updateDoc(basebaseUserDoc, basebaseUserData);

          const newsUserDoc = doc(
            db,
            `newswithfriends/users/${existingUserId}`
          );
          await setDoc(newsUserDoc, newsWithFriendsUserData);

          console.log(
            `  ✅ Successfully updated user "${user.first} ${user.last}"`
          );
          updatedCount++;
        } else {
          console.log(
            `  ➕ User not found in BaseBase - creating new user with ID: ${user._id}`
          );

          // Create new user in both collections using MongoDB ID
          const basebaseUserDoc = doc(db, `basebase/users/${user._id}`);
          await setDoc(basebaseUserDoc, basebaseUserData);

          const newsUserDoc = doc(db, `newswithfriends/users/${user._id}`);
          await setDoc(newsUserDoc, newsWithFriendsUserData);

          console.log(
            `  ✅ Successfully created user "${user.first} ${user.last}" with ID: ${user._id}`
          );
          createdCount++;
        }

        successCount++;
      } catch (error: any) {
        console.error(`❌ Failed to migrate user "${user.first} ${user.last}"`);
        console.error(`  Error: ${error.message}`);
        errorCount++;
      }
    }

    console.log("\n🏁 MIGRATION SUMMARY:");
    console.log(`📊 Total users found: ${users.length}`);
    console.log(`✅ Successfully processed: ${successCount}`);
    console.log(`➕ Created new users: ${createdCount}`);
    console.log(`🔄 Updated existing users: ${updatedCount}`);
    console.log(`⏭️  Skipped: ${skipCount}`);
    console.log(`❌ Failed: ${errorCount}`);
    console.log(
      `📈 Success rate: ${((successCount / users.length) * 100).toFixed(1)}%`
    );
  } catch (error) {
    console.error("\nMigration failed:", error);
    process.exit(1);
  } finally {
    // Close MongoDB connection
    if (mongoClient) {
      console.log("\nClosing MongoDB connection");
      await mongoClient.close();
      console.log("MongoDB connection closed");
    }
  }
}

// Run the migration
console.log("Starting user migration process...");
migrateUsers();
