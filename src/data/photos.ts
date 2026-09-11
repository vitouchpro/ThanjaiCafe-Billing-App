/* ============================================================
   Product photography.

   Real photographs of each dish, curated one by one and checked against the
   actual item — stock search for South Indian food returns a lot of wrong
   dishes, so nothing here was accepted on a search ranking alone.

   Sources: Wikimedia Commons (CC BY / CC BY-SA / CC0) and Unsplash. Files are
   pre-cropped to 4:3 and encoded as 400px WebP, so the whole set is ~380 KB
   and precaches for offline use with the rest of the app.

   Each photo also gets a light local pass (see `process-photos.mjs` at the
   project root, and the pristine originals kept in `photo-backups/`): a
   tighter crop to pull an unrelated prop, watermark, or extra object out of
   frame, and — only where the source background was already light — a soft
   fade to a clean white card rather than leaving it edge-to-edge. On a dark
   or patterned background that fade just looks hazy without ever reaching
   white, so those keep their real background, just tightened; the app's own
   product-card frame (white padding, rounded corners, a soft shadow) does
   the rest of the work toward a consistent, app-store-style grid.

   Attribution for the CC BY-SA images is in PHOTO_CREDITS below and shown in
   Settings → About.

   Anything without a usable photograph falls back to the hand-drawn
   illustration in `illustrations.ts` — better an honest drawing than a
   picture of the wrong food, or an unusably blurred one (Masala Tea).
   ============================================================ */

/** Product name → bundled photo path. */
const PHOTOS: Record<string, string> = {
  "Badam Milk": "/products/badam-milk.webp",
  "Banana Bajji": "/products/banana-bajji.webp",
  "Black Coffee": "/products/black-coffee.webp",
  "Bonda": "/products/bonda.webp",
  "Cold Coffee": "/products/cold-coffee.webp",
  "Filter Coffee": "/products/filter-coffee.webp",
  "Ginger Tea": "/products/ginger-tea.webp",
  "Green Tea": "/products/green-tea.webp",
  "Idli (2 pcs)": "/products/idli-2-pcs.webp",
  "Jangiri": "/products/jangiri.webp",
  "Kambu Kozhukattai": "/products/kambu-kozhukattai.webp",
  "Lemon Tea": "/products/lemon-tea.webp",
  "Masala Dosa": "/products/masala-dosa.webp",
  "Millet Bonda": "/products/millet-bonda.webp",
  "Murukku": "/products/murukku.webp",
  "Mysore Pak": "/products/mysore-pak.webp",
  "Plain Dosa": "/products/plain-dosa.webp",
  "Pongal": "/products/pongal.webp",
  "Poori (2 pcs)": "/products/poori-2-pcs.webp",
  "Ragi Adai": "/products/ragi-adai.webp",
  "Rava Kesari": "/products/rava-kesari.webp",
  "Samosa": "/products/samosa.webp",
  "Sukku Coffee": "/products/sukku-coffee.webp",
  "Thattai": "/products/thattai.webp",
  "Upma": "/products/upma.webp",
  "Vadai": "/products/vadai.webp",
};

export interface PhotoCredit {
  title: string;
  license: string;
}

/** Source and licence for every bundled photograph. */
export const PHOTO_CREDITS: Record<string, PhotoCredit> = {
  "Badam Milk": { title: "NAfJt7SDP7s", license: "Unsplash License" },
  "Banana Bajji": { title: "Bajji with coconut chutney.jpg", license: "CC BY-SA 3.0" },
  "Black Coffee": { title: "A small cup of coffee.JPG", license: "CC BY-SA 2.0" },
  "Bonda": { title: "Mysuru Bonda.jpg", license: "CC BY-SA 4.0" },
  "Cold Coffee": { title: "f_Fpa1EnDh0", license: "Unsplash License" },
  "Filter Coffee": { title: "Indian filter coffee in Dabarah.jpg", license: "CC BY-SA 3.0" },
  "Ginger Tea": { title: "A Cup Of Ginger Tea.jpg", license: "CC0" },
  "Green Tea": { title: "DrTXmESWaN8", license: "Unsplash License" },
  "Idli (2 pcs)": { title: "Idli Sambar-Noida-UP-SP004.jpg", license: "CC BY-SA 4.0" },
  "Jangiri": { title: "Imarti round round.JPG", license: "CC BY-SA 4.0" },
  "Kambu Kozhukattai": { title: "Kozhukattai flower shaped.jpg", license: "CC BY-SA 4.0" },
  "Lemon Tea": { title: "Tea with lemon and a glass of water, 2012.jpg", license: "CC BY 2.0" },
  "Masala Dosa": { title: "Masala dosa 01.jpg", license: "CC BY-SA 4.0" },
  "Millet Bonda": { title: "Su_Tte_jxYE", license: "Unsplash License" },
  "Murukku": { title: "\"Aesthetic Murukku of Salem\".jpg", license: "CC BY-SA 4.0" },
  "Mysore Pak": { title: "Mysore Pak by Dr. Raju Kasambe DSCN8105 03.jpg", license: "CC BY-SA 4.0" },
  "Plain Dosa": { title: "Dosa (Plain).jpg", license: "CC BY-SA 4.0" },
  "Pongal": { title: "Ven pongal.jpg", license: "CC BY-SA 4.0" },
  "Poori (2 pcs)": { title: "Aloo Puri.jpg", license: "CC BY-SA 4.0" },
  "Ragi Adai": { title: "Adai dosai.jpg", license: "CC BY-SA 4.0" },
  "Rava Kesari": { title: "Rava Kesari.jpg", license: "CC BY-SA 4.0" },
  "Samosa": { title: "Samosa with sweet chutney.jpg", license: "CC0" },
  "Sukku Coffee": { title: "Sukkumalli Coffee or Dry Ginger Coffee.jpg", license: "CC BY-SA 4.0" },
  "Thattai": { title: "\"Thattu Vadai\".jpg", license: "CC BY-SA 4.0" },
  "Upma": { title: "Broken rice upma & coconut chutney.jpg", license: "CC BY-SA 4.0" },
  "Vadai": { title: "Aesthetic Medu Vadai.jpg", license: "CC BY-SA 4.0" },
};

export const productPhoto = (name: string): string | undefined => PHOTOS[name];

export const hasPhoto = (name: string): boolean => name in PHOTOS;

export const PHOTOGRAPHED_PRODUCTS = Object.keys(PHOTOS);
