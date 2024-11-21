export class StringHelper {
  static generateRandomString(size: number): string {
    const alphanumeric =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomString = '';

    for (let i = 0; i < size; i++) {
      const randomIndex = Math.floor(Math.random() * alphanumeric.length);
      randomString += alphanumeric.charAt(randomIndex);
    }

    return randomString;
  }
}
