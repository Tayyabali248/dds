// Random data generators for DDS entries: names, addresses (with approximate
// Rahim Yar Khan coordinates), contact numbers, and emails.

// Approximate coordinates per locality in Rahim Yar Khan. These are
// city-center-based approximations (not precise geocoding) since these
// small localities aren't reliably found in geocoding databases.
const ADDRESSES = [
  { name: 'Abbasia Bungalows', lat: 28.4312, lng: 70.3049 },
  { name: 'Satellite Town', lat: 28.4180, lng: 70.2870 },
  { name: 'Gulshan Iqbal', lat: 28.4152, lng: 70.3089 },
  { name: 'Gulshan Usman', lat: 28.4112, lng: 70.2929 },
  { name: 'Veha Bungalows', lat: 28.4362, lng: 70.2839 },
];

// Boys' first names only.
const FIRST_NAMES = [
  'Muhammad', 'Ahmed', 'Ali', 'Hassan', 'Hussain', 'Bilal', 'Usman', 'Umar', 'Abdullah', 'Zain',
  'Talha', 'Hamza', 'Fahad', 'Faisal', 'Imran', 'Kashif', 'Waqas', 'Adeel', 'Asad', 'Kamran',
  'Shahzad', 'Naveed', 'Tariq', 'Rizwan', 'Saad', 'Junaid', 'Arslan', 'Rashid', 'Amjad', 'Yasir',
  'Sohail', 'Nadeem', 'Farhan', 'Salman', 'Zeeshan', 'Shoaib', 'Aamir', 'Aftab', 'Irfan', 'Jawad',
  'Khalid', 'Mudassar', 'Mohsin', 'Qasim', 'Sajid', 'Shahid', 'Waseem', 'Zubair', 'Danish', 'Haris',
];

// Proper given names used as a second name (no caste/tribe/clan names).
const LAST_NAMES = [
  'Raza', 'Abbas', 'Rehman', 'Farooq', 'Aslam', 'Sultan', 'Yaqoob', 'Yusuf', 'Ibrahim', 'Ismail',
  'Younis', 'Idrees', 'Shakeel', 'Nawaz', 'Anwar', 'Ashraf', 'Akram', 'Iqbal', 'Karim', 'Rahim',
  'Aziz', 'Bashir', 'Ghani', 'Hafeez', 'Jameel', 'Kareem', 'Latif', 'Majeed', 'Nasir', 'Qadir',
  'Rafiq', 'Saleem', 'Tanveer', 'Zafar', 'Zahid', 'Hanif', 'Sarwar', 'Mehmood', 'Riaz', 'Siddique',
  'Habib', 'Jamal', 'Kamal', 'Sabir', 'Tahir', 'Wahid', 'Yamin', 'Zaman', 'Ehsan', 'Fareed',
];

function buildNamePool(size = 250) {
  const combos = [];
  for (const f of FIRST_NAMES) {
    for (const l of LAST_NAMES) {
      combos.push(`${f} ${l}`);
    }
  }
  // Fisher-Yates shuffle
  for (let i = combos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combos[i], combos[j]] = [combos[j], combos[i]];
  }
  return combos.slice(0, size);
}

const NAME_POOL = buildNamePool(250);

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomName() {
  return randomItem(NAME_POOL);
}

function randomAddress() {
  return randomItem(ADDRESSES);
}

// 03 + two digits in range 00-49 + 7 random digits = 11-digit PK mobile number
function randomContactNumber() {
  const secondPair = String(Math.floor(Math.random() * 50)).padStart(2, '0');
  let rest = '';
  for (let i = 0; i < 7; i++) rest += Math.floor(Math.random() * 10);
  return `03${secondPair}${rest}`;
}

// Converts a distance in meters to degrees of latitude/longitude near a
// given latitude (longitude degrees shrink as you move away from the equator).
function metersToDegreesLat(meters) {
  return meters / 110540;
}
function metersToDegreesLng(meters, atLat) {
  const radLat = (atLat * Math.PI) / 180;
  return meters / (111320 * Math.cos(radLat));
}

// Coordinates already handed out, so no two entries ever land on the exact
// same point (which the DDS system would treat as a duplicate entry).
const usedCoords = new Set();

function randomLatLngForAddress(address) {
  let lat, lng, key;
  let spread = 150; // meters; grows only if we happen to collide (practically never)
  do {
    const angle = Math.random() * 2 * Math.PI;
    const distance = 50 + Math.random() * spread; // 50m - (50+spread)m from the address's base point
    const dLat = metersToDegreesLat(distance * Math.sin(angle));
    const dLng = metersToDegreesLng(distance * Math.cos(angle), address.lat);
    lat = (address.lat + dLat).toFixed(6);
    lng = (address.lng + dLng).toFixed(6);
    key = `${lat},${lng}`;
    spread += 50;
  } while (usedCoords.has(key));
  usedCoords.add(key);
  return { lat, lng };
}

function randomEmail(name) {
  const base = name.toLowerCase().replace(/[^a-z]/g, '');
  const digitCount = 2 + Math.floor(Math.random() * 4); // 2-5 digits
  let digits = '';
  for (let i = 0; i < digitCount; i++) digits += Math.floor(Math.random() * 10);
  return `${base}${digits}@gmail.com`;
}

module.exports = {
  randomName,
  randomAddress,
  randomContactNumber,
  randomLatLngForAddress,
  randomEmail,
};
