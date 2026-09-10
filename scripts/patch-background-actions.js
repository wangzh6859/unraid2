const fs = require('fs');
const path = require('path');

const targetFile = path.resolve(
  __dirname,
  '../node_modules/react-native-background-actions/android/src/main/java/com/asterinet/react/bgactions/RNBackgroundActionsTask.java'
);

if (!fs.existsSync(targetFile)) {
  console.log('[patch-background-actions] File not found, skipping patch:', targetFile);
  process.exit(0);
}

let content = fs.readFileSync(targetFile, 'utf8');

// Target the intent creation block inside buildNotification
const originalBlock = `        Intent notificationIntent;
        if (linkingURI != null) {
            notificationIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(linkingURI));
        } else {
            //as RN works on single activity architecture - we don't need to find current activity on behalf of react context
            notificationIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (notificationIntent == null) {
                notificationIntent = new Intent(Intent.ACTION_MAIN)
                        .addCategory(Intent.CATEGORY_LAUNCHER)
                        .setPackage(context.getPackageName());
            }
        }`;

const replacementBlock = `        Intent notificationIntent;
        if (linkingURI != null) {
            notificationIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(linkingURI));
            notificationIntent.setPackage(context.getPackageName());
        } else {
            notificationIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (notificationIntent == null) {
                notificationIntent = new Intent(Intent.ACTION_MAIN)
                        .addCategory(Intent.CATEGORY_LAUNCHER);
            }
            notificationIntent.setPackage(context.getPackageName());
        }
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED | Intent.FLAG_ACTIVITY_SINGLE_TOP);`;

if (content.includes(originalBlock)) {
  content = content.replace(originalBlock, replacementBlock);
  fs.writeFileSync(targetFile, content, 'utf8');
  console.log('[patch-background-actions] Successfully patched RNBackgroundActionsTask.java with explicit package and singleTop flags.');
} else if (content.includes('notificationIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED | Intent.FLAG_ACTIVITY_SINGLE_TOP);')) {
  console.log('[patch-background-actions] RNBackgroundActionsTask.java is already patched.');
} else {
  // Regex-based fallback in case of whitespace/line-ending differences
  const regex = /Intent\s+notificationIntent;\s+if\s*\(linkingURI\s*!=\s*null\)\s*\{\s*notificationIntent\s*=\s*new\s+Intent\(Intent\.ACTION_VIEW,\s*Uri\.parse\(linkingURI\)\);\s*\}\s*else\s*\{[\s\S]*?notificationIntent\s*=\s*context\.getPackageManager\(\)\.getLaunchIntentForPackage\(context\.getPackageName\(\)\);[\s\S]*?\}\s*\}/m;
  if (regex.test(content)) {
    content = content.replace(regex, replacementBlock.trim());
    fs.writeFileSync(targetFile, content, 'utf8');
    console.log('[patch-background-actions] Successfully patched RNBackgroundActionsTask.java using regex match.');
  } else {
    console.warn('[patch-background-actions] Warning: Could not find target pattern in RNBackgroundActionsTask.java.');
  }
}
