/*
 * Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A failed Three.js load used to leave the WebGL renderer alive: the effect created the renderer
 * before any file loaded, but cleanup only disposed through viewerInstanceRef, which was set after
 * a successful scene. Unmounting after every file fails must call renderer.dispose and remove the
 * canvas.
 */
import React from "react";
import { render, waitFor, act } from "@testing-library/react";
import ThreeJSViewerComponent from "./ThreeJSViewerComponent";

const mockDispose = jest.fn();
const mockEnvDispose = jest.fn();
function mockMakeTHREE() {
    function Color() {}
    function Scene(this: Record<string, unknown>) {
        this.background = null;
        this.add = jest.fn();
        this.traverse = jest.fn();
    }
    function PerspectiveCamera(this: Record<string, unknown>) {
        this.position = { set: jest.fn() };
        this.lookAt = jest.fn();
        this.updateProjectionMatrix = jest.fn();
        this.fov = 60;
        this.aspect = 1;
        this.near = 0.1;
        this.far = 1000;
    }
    function WebGLRenderer(this: Record<string, unknown>) {
        this.setSize = jest.fn();
        this.setPixelRatio = jest.fn();
        this.render = jest.fn();
        this.dispose = mockDispose;
        // Real canvas so container.appendChild accepts it.
        this.domElement = document.createElement("canvas");
    }
    function Box3(this: Record<string, unknown>) {
        this.union = jest.fn().mockReturnThis();
        this.setFromObject = jest.fn().mockReturnThis();
        this.getSize = jest.fn(() => ({ x: 1, y: 1, z: 1 }));
        this.getCenter = jest.fn(() => ({ x: 0, y: 0, z: 0 }));
        this.intersectsBox = jest.fn(() => false);
    }
    function Vector3(this: Record<string, unknown>) {
        this.set = jest.fn();
    }
    function Group(this: Record<string, unknown>) {
        this.name = "";
        this.userData = {};
        this.add = jest.fn();
        this.children = [];
        this.traverse = jest.fn();
    }
    function Euler(this: Record<string, unknown>) {
        this.setFromQuaternion = jest.fn().mockReturnThis();
    }
    return {
        Color,
        Scene,
        PerspectiveCamera,
        WebGLRenderer,
        Box3,
        Vector3,
        Vector2: function Vector2() {},
        Raycaster: function Raycaster() {},
        Group,
        AnimationMixer: function AnimationMixer() {},
        Clock: function Clock() {},
        Quaternion: function Quaternion() {},
        Euler,
    };
}

jest.mock("./dependencies", () => ({
    ThreeJSDependencyManager: {
        loadThreeJS: jest.fn(async () => {
            (globalThis as { THREE?: unknown; THREEBundle?: unknown }).THREE = mockMakeTHREE();
            (globalThis as { THREE?: unknown; THREEBundle?: unknown }).THREEBundle = {
                THREE: (globalThis as { THREE?: unknown }).THREE,
            };
        }),
        cleanup: jest.fn(),
    },
}));

jest.mock("./utils/sceneLighting", () => ({
    applySceneLighting: jest.fn(),
    applySceneEnvironment: jest.fn(() => ({ dispose: mockEnvDispose })),
}));

jest.mock("./utils/fileLoaders", () => ({
    loadFile: jest.fn(async () => {
        throw new Error("parse failed");
    }),
}));

jest.mock("./utils/gltfDependencyLoader", () => ({
    preloadGLTFDependencies: jest.fn(),
    cleanupBlobUrls: jest.fn(),
}));

jest.mock("./MouseControls", () => ({
    MouseControls: jest.fn().mockImplementation(() => ({
        setTarget: jest.fn(),
        dispose: jest.fn(),
        hasMoved: false,
    })),
}));

jest.mock("../../../services/appCache", () => ({
    appCache: { getItem: () => ({ api: "https://api.example/api/" }) },
}));

jest.mock("../../../utils/authTokenUtils", () => ({
    getDualAuthorizationHeader: jest.fn(async () => "Bearer t"),
    getDualValidAccessToken: jest.fn(async () => "t"),
}));

jest.mock("./ThreeJSPanel", () => ({ __esModule: true, default: () => null }));
jest.mock("./components/Controls", () => ({ __esModule: true, default: () => null }));
jest.mock("./ThreeJSMaterialLibrary", () => ({
    __esModule: true,
    default: () => null,
}));

describe("ThreeJS viewer failed-load cleanup", () => {
    beforeEach(() => {
        mockDispose.mockClear();
        mockEnvDispose.mockClear();
        jest.spyOn(console, "log").mockImplementation(() => undefined);
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
        jest.spyOn(console, "error").mockImplementation(() => undefined);
        global.fetch = jest.fn(async () => ({
            ok: false,
            status: 404,
        })) as unknown as typeof fetch;
        Object.defineProperty(HTMLElement.prototype, "clientWidth", {
            configurable: true,
            get: () => 800,
        });
        Object.defineProperty(HTMLElement.prototype, "clientHeight", {
            configurable: true,
            get: () => 600,
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete (globalThis as { THREE?: unknown }).THREE;
        delete (globalThis as { THREEBundle?: unknown }).THREEBundle;
    });

    it("disposes the WebGL renderer when every file fails and the viewer unmounts", async () => {
        const view = render(
            (
                <ThreeJSViewerComponent
                    assetId="a1"
                    databaseId="d1"
                    assetKey="folder/broken.glb"
                />
            ) as React.ReactElement
        );

        await waitFor(() => {
            expect(view.container.textContent).toMatch(/404|Failed|broken|supported 3D/i);
        });

        // Renderer was created and stashed before the failed fetch; still live until unmount.
        expect(mockDispose).not.toHaveBeenCalled();
        expect(view.container.querySelector("canvas")).not.toBeNull();

        const removeSpy = jest.spyOn(Node.prototype, "removeChild");

        act(() => {
            view.unmount();
        });

        expect(mockDispose).toHaveBeenCalled();
        expect(mockEnvDispose).toHaveBeenCalled();
        expect(removeSpy).toHaveBeenCalled();
        removeSpy.mockRestore();
    });
});
