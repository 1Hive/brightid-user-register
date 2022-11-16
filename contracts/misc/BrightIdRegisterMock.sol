pragma solidity ^0.4.24;

import "@1hive/contract-helpers-test/contracts/0.4/aragonOS/TimeHelpersMock.sol";
import "../BrightIdRegister.sol";

contract BrightIdRegisterMock is TimeHelpersMock, BrightIdRegister {}
