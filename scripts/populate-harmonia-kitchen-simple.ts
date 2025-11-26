import { db } from '../src/db';
import { menuItems, restaurantKnowledge, faqKnowledgeBase } from '../src/shared/schema';
import { s3StorageService } from '../src/s3Storage';
import * as fs from 'fs';
import * as path from 'path';

const RESTAURANT_ID = '40ececcc-4015-402f-a6ce-6e951db5ef69';

interface MenuItem {
  name: string;
  description: string;
  price: number;
  category: string;
  imageFile: string;
}

const menuItemsData: MenuItem[] = [
  // Main Dishes
  {
    name: "Jollof Rice",
    description: "Authentic Nigerian jollof rice cooked in rich tomato sauce with chicken and traditional spices",
    price: 15.99,
    category: "Main Dishes",
    imageFile: "nigerian_jollof_rice_773750bc.jpg"
  },
  {
    name: "Suya (Beef Skewers)",
    description: "Spicy grilled beef skewers marinated in traditional suya spice blend with onions and peppers",
    price: 12.99,
    category: "Main Dishes",
    imageFile: "nigerian_suya_meat_s_3074bb82.jpg"
  },
  {
    name: "Egusi Soup with Fufu",
    description: "Rich melon seed soup with assorted meat, fish, and vegetables served with pounded yam",
    price: 18.99,
    category: "Main Dishes",
    imageFile: "nigerian_egusi_soup__0d0f59a9.jpg"
  },
  {
    name: "Nigerian Fried Rice",
    description: "Colorful fried rice with mixed vegetables, shrimp, and chicken in Nigerian style",
    price: 14.99,
    category: "Main Dishes",
    imageFile: "nigerian_fried_rice__f2113759.jpg"
  },
  {
    name: "Pepper Soup",
    description: "Spicy and aromatic goat meat soup with traditional herbs and spices",
    price: 16.99,
    category: "Main Dishes",
    imageFile: "nigerian_pepper_soup_ad7f0f4c.jpg"
  },
  // Add more items as needed...
];

async function uploadImage(localPath: string, objectName: string): Promise<string> {
  const fileBuffer = fs.readFileSync(localPath);
  
  const result = await s3StorageService.uploadObject(
    `public/${objectName}`,
    fileBuffer,
    'image/jpeg'
  );
  
  return result;
}

async function main() {
  console.log('🍽️  Populating Harmonia Kitchen with menu items...\n');

  // Upload images and create menu items
  console.log('📸 Uploading images and creating menu items...');
  for (const item of menuItemsData) {
    try {
      const localImagePath = path.join(__dirname, '../assets/stock_images', item.imageFile);
      
      // Upload image to S3
      const imageUrl = await uploadImage(localImagePath, item.imageFile);
      console.log(`✅ Uploaded: ${item.name}`);

      // Create menu item
      await db.insert(menuItems).values({
        restaurantId: RESTAURANT_ID,
        name: item.name,
        description: item.description,
        price: item.price.toString(),
        category: item.category,
        imageUrl: imageUrl,
        available: true,
      });

    } catch (error) {
      console.error(`❌ Error with ${item.name}:`, error);
    }
  }

  console.log('\n🎉 Harmonia Kitchen menu items successfully created!');
  console.log(`📊 Created ${menuItemsData.length} menu items with photos`);
}

main().catch(console.error);