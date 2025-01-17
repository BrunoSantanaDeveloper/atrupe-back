// import { extname } from 'path';
// //multer-config.ts
// import multerS3 from 'multer-s3';
// import { S3Client } from '@aws-sdk/client-s3';

// const s3Config = new S3Client({
//   region: 'us-east-1',
//   credentials: {
//     accessKeyId: process.env.S3_ACCESS_KEY,
//     secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
//   },
// });

const multerConfigS3 = {
  //   storage: multerS3({
  //     s3: s3Config,
  //     bucket: 'chaozao-files-s3',
  //     contentType: multerS3.AUTO_CONTENT_TYPE,
  //     acl: 'public-read',
  //     key: (req, file, cb) => {
  //       const randomName =
  //         Date.now() +
  //         '-' +
  //         Math.round(Math.random() * 1e9) +
  //         extname(file.originalname);
  //       cb(null, randomName);
  //     },
  //   }),
};

export default multerConfigS3;
