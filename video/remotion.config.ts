import { Config } from "@remotion/cli/config";

// High-quality stills for review frames and crisp H.264 for the final exports.
Config.setVideoImageFormat("jpeg");
Config.setStillImageFormat("png");
Config.setJpegQuality(95);
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
Config.setOverwriteOutput(true);
