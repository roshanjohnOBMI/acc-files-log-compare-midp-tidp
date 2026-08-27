import { AuthenticationClient } from "@aps_sdk/authentication";
import { DataManagementClient } from "@aps_sdk/data-management";
import { OssClient } from "@aps_sdk/oss";
import { SdkManagerBuilder } from "@aps_sdk/autodesk-sdkmanager";

const sdkManager = SdkManagerBuilder.create().build();

export const authenticationClient = new AuthenticationClient({ sdkManager });
export const dataManagementClient = new DataManagementClient({ sdkManager });
export const ossClient = new OssClient({ sdkManager });
