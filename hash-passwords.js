const bcrypt = require('bcrypt');

// Function to hash a password
function hashPassword(password, saltRounds = 10) {
    const hashedPassword = bcrypt.hashSync(password, saltRounds);
    console.log(`Hashed password for "${password}": ${hashedPassword}`);
    return hashedPassword;
}

// Example usage
const passwords = ['adminpass', 'user1pass']; // Replace with actual passwords
passwords.forEach(password => hashPassword(password));
