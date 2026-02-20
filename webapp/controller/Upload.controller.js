sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/BusyIndicator",
    "sap/ui/core/Item",
    "sap/ui/core/format/DateFormat"
], function (
    Controller, JSONModel, MessageBox,
    MessageToast, BusyIndicator, Item, DateFormat
) {
    "use strict";

    return Controller.extend(
        "com.mycompany.fileupload.controller.Upload", {

        /* ===================================================
         * LIFECYCLE
         * =================================================== */

        onInit: function () {
            var oViewModel = new JSONModel({
                fileCount: 0,
                logVisible: false,
                logEntries: [],
                uploading: false
            });
            this.getView().setModel(oViewModel, "viewModel");

            this._csrfToken = null;
            this._serviceUrl = this._getServiceUrl();
            this._oDateFormat = DateFormat.getDateTimeInstance({
                pattern: "HH:mm:ss"
            });
        },

        /* ===================================================
         * CONFIGURATION
         * =================================================== */

        _getServiceUrl: function () {
            // --- OPTION A: Standard Attachment Service ---
            return "/sap/opu/odata/sap/API_CV_ATTACHMENT_SRV";

            // --- OPTION B: Custom OData service ---
            // return "/sap/opu/odata/sap/ZFILE_UPLOAD_SRV";

            // --- OPTION C: DMS service ---
            // return "/sap/opu/odata/sap/CV_ATTACHMENT_SRV";
        },

        /* ===================================================
         * CSRF TOKEN
         * =================================================== */

        _fetchCsrfToken: function () {
            var that = this;
            return new Promise(function (resolve, reject) {
                if (that._csrfToken) {
                    resolve(that._csrfToken);
                    return;
                }
                jQuery.ajax({
                    url: that._serviceUrl + "/",
                    method: "GET",
                    headers: {
                        "X-CSRF-Token": "Fetch"
                    },
                    success: function (data, status, xhr) {
                        that._csrfToken =
                            xhr.getResponseHeader("X-CSRF-Token");
                        resolve(that._csrfToken);
                    },
                    error: function (xhr) {
                        reject(new Error(
                            "CSRF token fetch failed: " + xhr.status
                        ));
                    }
                });
            });
        },

        _invalidateCsrfToken: function () {
            this._csrfToken = null;
        },

        /* ===================================================
         * UPLOAD ALL
         * =================================================== */

        onUploadAll: function () {
            var oUploadSet = this.byId("uploadSet");
            var aItems = oUploadSet.getIncompleteItems();

            if (aItems.length === 0) {
                MessageToast.show(
                    this._i18n("noFilesSelected")
                );
                return;
            }

            var that = this;
            var sMsg = this._i18n("confirmUpload", [
                aItems.length
            ]);

            MessageBox.confirm(sMsg, {
                title: this._i18n("confirmTitle"),
                onClose: function (oAction) {
                    if (oAction === MessageBox.Action.OK) {
                        that._executeUpload(aItems);
                    }
                }
            });
        },

        _executeUpload: function (aItems) {
            var that = this;
            var oModel = this.getView().getModel("viewModel");
            oModel.setProperty("/uploading", true);
            BusyIndicator.show(0);

            this._fetchCsrfToken()
                .then(function (sToken) {
                    return that._uploadFilesSequentially(
                        aItems, sToken
                    );
                })
                .then(function (aResults) {
                    BusyIndicator.hide();
                    oModel.setProperty("/uploading", false);

                    var iSuccess = aResults.filter(function (r) {
                        return r.success;
                    }).length;
                    var iFailed = aResults.length - iSuccess;

                    if (iFailed > 0 && iSuccess > 0) {
                        MessageBox.warning(
                            that._i18n("partialSuccess", [
                                iSuccess, iFailed
                            ])
                        );
                    } else if (iFailed > 0) {
                        MessageBox.error(
                            that._i18n("allFailed", [iFailed])
                        );
                    } else {
                        MessageBox.success(
                            that._i18n("allSuccess", [iSuccess])
                        );
                    }
                })
                .catch(function (oError) {
                    BusyIndicator.hide();
                    oModel.setProperty("/uploading", false);
                    that._invalidateCsrfToken();
                    MessageBox.error(
                        that._i18n("uploadError") +
                        "\n" + oError.message
                    );
                });
        },

        /* ===================================================
         * SEQUENTIAL UPLOAD (one file at a time)
         * =================================================== */

        _uploadFilesSequentially: function (aItems, sToken) {
            var that = this;
            var aResults = [];

            return aItems.reduce(function (pChain, oItem) {
                return pChain.then(function () {
                    return that._uploadSingleFile(
                        oItem, sToken
                    ).then(function (oResult) {
                        aResults.push(oResult);
                    });
                });
            }, Promise.resolve()).then(function () {
                return aResults;
            });
        },

        /* ===================================================
         * PARALLEL UPLOAD (all files at once)
         *
         * Swap _uploadFilesSequentially with this method
         * in _executeUpload if concurrency is acceptable.
         * =================================================== */

        _uploadFilesParallel: function (aItems, sToken) {
            var that = this;
            var aPromises = aItems.map(function (oItem) {
                return that._uploadSingleFile(oItem, sToken);
            });
            return Promise.all(aPromises);
        },

        /* ===================================================
         * SINGLE FILE UPLOAD
         * =================================================== */

        _uploadSingleFile: function (oItem, sToken) {
            var that = this;
            var oFile = oItem.getFileObject();
            var sFileName = oFile.name;
            var sMimeType =
                oFile.type || "application/octet-stream";
            var sSlug = encodeURIComponent(sFileName);

            var sObjectType =
                this.byId("inputObjectType").getValue();
            var sObjectKey =
                this.byId("inputObjectKey").getValue();
            var sSemanticObj =
                this.byId("inputSemanticObject").getValue();

            var sUploadUrl =
                this._serviceUrl + "/AttachmentContentSet";

            var oHeaders = {
                "X-CSRF-Token": sToken,
                "Content-Type": sMimeType,
                "Slug": sSlug
            };
            if (sObjectType) {
                oHeaders.BusinessObjectTypeName = sObjectType;
            }
            if (sObjectKey) {
                oHeaders.LinkedSAPObjectKey = sObjectKey;
            }
            if (sSemanticObj) {
                oHeaders.SemanticObjectType = sSemanticObj;
            }

            return new Promise(function (resolve) {
                jQuery.ajax({
                    url: sUploadUrl,
                    method: "POST",
                    headers: oHeaders,
                    processData: false,
                    contentType: sMimeType,
                    data: oFile,
                    success: function (data, status, xhr) {
                        that._addLogEntry(
                            sFileName,
                            that._i18n("successMsg"),
                            true
                        );
                        resolve({
                            success: true,
                            fileName: sFileName,
                            response: data
                        });
                    },
                    error: function (xhr) {
                        var sError = that._parseError(xhr);
                        if (xhr.status === 403) {
                            that._invalidateCsrfToken();
                        }
                        that._addLogEntry(
                            sFileName, sError, false
                        );
                        resolve({
                            success: false,
                            fileName: sFileName,
                            error: sError
                        });
                    }
                });
            });
        },

        /* ===================================================
         * LOGGING
         * =================================================== */

        _addLogEntry: function (sFileName, sMessage, bSuccess) {
            var oModel =
                this.getView().getModel("viewModel");
            var aEntries =
                oModel.getProperty("/logEntries").slice();

            aEntries.unshift({
                fileName: sFileName,
                message: sMessage,
                icon: bSuccess
                    ? "sap-icon://message-success"
                    : "sap-icon://message-error",
                highlight: bSuccess ? "Success" : "Error",
                timestamp: this._oDateFormat.format(new Date())
            });

            oModel.setProperty("/logEntries", aEntries);
            oModel.setProperty("/logVisible", true);
        },

        onClearLog: function () {
            var oModel =
                this.getView().getModel("viewModel");
            oModel.setProperty("/logEntries", []);
            oModel.setProperty("/logVisible", false);
        },

        /* ===================================================
         * ERROR PARSING
         * =================================================== */

        _parseError: function (xhr) {
            try {
                var oBody = JSON.parse(xhr.responseText);
                if (oBody.error && oBody.error.message) {
                    return oBody.error.message.value;
                }
            } catch (e) {
                // XML response from OData
                try {
                    var oXml = jQuery.parseXML(
                        xhr.responseText
                    );
                    var sMsg = jQuery(oXml)
                        .find("message").text();
                    if (sMsg) { return sMsg; }
                } catch (ex) { /* fall through */ }
            }
            return "HTTP " + xhr.status +
                " – " + (xhr.statusText || "Unknown error");
        },

        /* ===================================================
         * UPLOADSET EVENT HANDLERS
         * =================================================== */

        onAfterItemAdded: function () {
            this._updateFileCount();
        },

        onAfterItemRemoved: function () {
            this._updateFileCount();
        },

        _updateFileCount: function () {
            var iCount = this.byId("uploadSet")
                .getIncompleteItems().length;
            this.getView().getModel("viewModel")
                .setProperty("/fileCount", iCount);
        },

        onFileTypeMismatch: function (oEvent) {
            var sName =
                oEvent.getParameter("item").getFileName();
            MessageBox.warning(
                this._i18n("fileTypeMismatch", [sName])
            );
        },

        onFileSizeExceeded: function (oEvent) {
            var sName =
                oEvent.getParameter("item").getFileName();
            MessageBox.warning(
                this._i18n("fileSizeExceeded", [sName])
            );
        },

        onBeforeUploadStarts: function (oEvent) {
            var oItem = oEvent.getParameter("item");
            oItem.addHeaderField(new Item({
                key: "X-CSRF-Token",
                text: this._csrfToken
            }));
        },

        onUploadCompleted: function (oEvent) {
            var iStatus = oEvent.getParameter("status");
            var sName =
                oEvent.getParameter("item").getFileName();
            var bOk = iStatus >= 200 && iStatus < 300;
            this._addLogEntry(
                sName,
                bOk
                    ? this._i18n("successMsg")
                    : this._i18n("failedMsg"),
                bOk
            );
        },

        onFileAdded: function (oEvent) {
            // FileUploader change event — files auto-add
            // to UploadSet; just refresh the count
            this._updateFileCount();
        },

        /* ===================================================
         * i18n HELPER
         * =================================================== */

        _i18n: function (sKey, aArgs) {
            var oBundle = this.getView().getModel("i18n")
                .getResourceBundle();
            return oBundle.getText(sKey, aArgs);
        }
    });
});
